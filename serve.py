#!/usr/bin/env python3
"""
Cozy Chat local server. Two jobs.

1. Serve the app, and never let a browser keep an old copy. Plain
   `python -m http.server` sends Last-Modified and answers conditional
   requests with 304, so a browser - or a service worker registered against
   127.0.0.1 - can keep showing a copy you already replaced on disk: `cozy`
   pulls an update, the files change, and the page looks identical. This
   handler forbids caching outright and ignores revalidation headers.

2. Keep your chats. They live on this phone in ~/.cozychat (COZY_DATA_DIR
   moves it): one JSON file per chat and per file, one for the settings -
   outside the app folder, so an update or a reinstall never touches them, and
   outside every browser, so clearing a browser never touches them either.
   Every browser that opens the app reads and writes the same files, the way
   SillyTavern keeps its data.

   Each record carries a revision number. A write names the revision it was
   made from; a tab that fell behind is told 409 with what the phone holds and
   merges, so it can never write over newer work. Every change is announced
   to every open tab (/api/store/events), so they stay current without a
   reload. Nothing is deleted outright: a deleted or replaced record moves to
   trash/ first and stays there for 30 days.
"""
import errno
import glob
import gzip
import hashlib
import ipaddress
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
try:
    import fcntl
except ImportError:      # not a phone, nor any Linux: there is nothing to lock with
    fcntl = None

ROOT = os.path.dirname(os.path.abspath(__file__))
SELF = os.path.abspath(__file__)
DATA_DIR = os.path.abspath(os.path.expanduser(os.environ.get("COZY_DATA_DIR") or "~/.cozychat"))
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
DIRS = {"chat": "chats", "file": "files"}
KINDS = ("chat", "file", "settings")
MAX_BODY = 1024 * 1024 * 1024     # a record can carry pictures; a gigabyte is past any real one
SENT_KEEP = 200                   # the newest replies of each chat that keep what was sent
TRASH_DAYS = 30
HEAD_RE = re.compile(rb'^\{"rev":(\d+),"data":')
BACKUP_KEEP = 14                  # daily copies of everything kept on the phone
BACKUP_RE = re.compile(r"^cozy-\d{4}-\d{2}-\d{2}\.json\.gz$")
MARKER = b'<meta name="cozy-store" content="2">'
LOCAL_NAMES = ("127.0.0.1", "localhost", "::1")


def _code_stamp():
    try:
        with open(SELF, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()[:12]
    except OSError:
        return ""


CODE = _code_stamp()   # what the launcher compares, to know this server is the one on disk


def _app_version():
    try:
        with open(os.path.join(ROOT, "index.html"), "r", encoding="utf-8", errors="replace") as f:
            m = re.search(r'const VERSION = "([\d.]+)"', f.read())
        return m.group(1) if m else ""
    except OSError:
        return ""


def _now_ms():
    return int(time.time() * 1000)


def _fsync_dir(d):
    try:
        fd = os.open(d, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _remove(p):
    try:
        os.remove(p)
    except OSError:
        pass


def _write_tmp(path, payload):
    """The new version beside the file, written whole and synced, for a rename
    to put in place. A write that fails (the phone out of room) takes its
    half-written temp file with it."""
    tmp = os.path.join(os.path.dirname(path), "." + os.path.basename(path) + "." + uuid.uuid4().hex[:8] + ".tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
    except BaseException:
        _remove(tmp)
        raise
    return tmp


def _write_atomic(path, payload):
    """The whole file or none of it: a write that dies halfway leaves the old
    file exactly as it was, and no temp file behind."""
    tmp = _write_tmp(path, payload)
    try:
        os.replace(tmp, path)
    except BaseException:
        _remove(tmp)
        raise
    _fsync_dir(os.path.dirname(path))


# what a write fails with when the phone has no room left for it
FULL = (errno.ENOSPC, errno.EDQUOT, errno.EFBIG)


def _dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _stamp(rec):
    if not isinstance(rec, dict):
        return 0
    for k in ("updatedAt", "createdAt"):
        v = rec.get(k)
        if isinstance(v, (int, float)):
            return v
    return 0


def _host_port(value):
    """A Host header as (name, port): "name:port", "[v6]:port", or "name"
    (port 80). (None, None) for anything else."""
    v = (value or "").strip().lower()
    if not v:
        return None, None
    if v.startswith("["):
        end = v.find("]")
        if end < 0 or (v[end + 1:] and not v[end + 1:].startswith(":")):
            return None, None
        name, port = v[1:end], v[end + 2:]
    elif v.count(":") == 1:
        name, port = v.split(":")
    elif ":" in v:
        return None, None
    else:
        name, port = v, ""
    if port and not port.isdigit():
        return None, None
    return name, int(port) if port else 80


def _own_name(name, bound):
    """This phone's own names for this server: loopback, the address it
    listens on, and - when it listens on every address - any address written
    as numbers. Never a domain name: whoever owns a name can point it at
    127.0.0.1."""
    if name in LOCAL_NAMES or name == (bound or "").lower():
        return True
    if bound in ("0.0.0.0", "::", ""):
        try:
            ipaddress.ip_address(name)
            return True
        except ValueError:
            return False
    return False


def _merge_settings(cur, inc):
    """Settings from somewhere else meet the ones on the phone: every
    connection, instruction set, saved prompt and project the phone does not
    have yet is added. A connection the phone has, arriving with a different
    address, key or model, comes in beside it as a copy named "(from this
    browser)" - which of the two keys still works is not something to guess,
    and dropping one silently left a dead key as the only one. (The whole
    incoming document is kept in imported/ by the caller as well.)"""
    out = dict(cur)
    changed = False
    for key in ("providers", "presets", "prompts", "projects"):
        mine = out.get(key) if isinstance(out.get(key), list) else []
        theirs = inc.get(key) if isinstance(inc.get(key), list) else []
        have = {x.get("id"): x for x in mine if isinstance(x, dict)}
        add = []
        for x in theirs:
            if not isinstance(x, dict) or not x.get("id"):
                continue
            there = have.get(x.get("id"))
            if there is None:
                add.append(x)
            elif key == "providers" and any(str(x.get(f) or "") != str(there.get(f) or "") for f in ("url", "apiKey", "model")):
                copy = dict(x)
                copy["id"] = "%s-b%d" % (x["id"], _now_ms())
                copy["name"] = "%s (from this browser)" % (x.get("name") or "Connection")
                add.append(copy)
        if add:
            out[key] = mine + add
            changed = True
    for k, v in inc.items():
        if k not in out:
            out[k] = v
            changed = True
    return out, changed


def _collect(v, out):
    """Every piece a stored request refers to ({"$t": [keys]})."""
    stack = [v]
    while stack:
        x = stack.pop()
        if isinstance(x, dict):
            t = x.get("$t")
            if len(x) == 1 and isinstance(t, list):
                out.update(k for k in t if isinstance(k, str))
            else:
                stack.extend(x.values())
        elif isinstance(x, list):
            stack.extend(x)


class Store:
    def __init__(self, root):
        self.root = root
        self.lock = threading.RLock()
        self.sent_lock = threading.Lock()
        self.revs = {"chat": {}, "file": {}, "settings": {}}
        self.listeners = []
        self.llock = threading.Lock()
        for sub in ("chats", "files", "sent", "trash"):
            os.makedirs(os.path.join(root, sub), exist_ok=True)
        self.meta = self._load_meta()
        self._scan()

    # ---------- places ----------
    def path(self, kind, rid):
        if kind == "settings":
            return os.path.join(self.root, "settings.json")
        return os.path.join(self.root, DIRS[kind], rid + ".json")

    def sent_path(self, chat):
        return os.path.join(self.root, "sent", chat + ".json")

    def _load_meta(self):
        p = os.path.join(self.root, "store.json")
        try:
            with open(p, "r", encoding="utf-8") as f:
                m = json.load(f)
            if isinstance(m, dict) and m.get("id"):
                return m
        except (OSError, ValueError):
            pass
        m = {"id": uuid.uuid4().hex, "created": _now_ms()}
        _write_atomic(p, _dump(m))
        return m

    def save_meta(self):
        _write_atomic(os.path.join(self.root, "store.json"), _dump(self.meta))

    @staticmethod
    def _read(p):
        try:
            with open(p, "rb") as f:
                return f.read()
        except OSError:
            return None

    @staticmethod
    def _read_rev(p):
        try:
            with open(p, "rb") as f:
                head = f.read(48)
        except OSError:
            return 0
        m = HEAD_RE.match(head)
        return int(m.group(1)) if m else 0

    def _scan(self):
        for kind, sub in DIRS.items():
            d = os.path.join(self.root, sub)
            for name in os.listdir(d):
                if not name.endswith(".json") or not ID_RE.match(name[:-5]):
                    continue
                rev = self._read_rev(os.path.join(d, name))
                if rev:
                    self.revs[kind][name[:-5]] = rev
        rev = self._read_rev(self.path("settings", "main"))
        if rev:
            self.revs["settings"]["main"] = rev

    def tidy(self):
        """Half-written temp files from a write that died - in every folder
        the server writes - and old trash (prune_trash)."""
        for sub in ("chats", "files", "sent", "trash", "backups", "imported", ""):
            d = os.path.join(self.root, sub)
            try:
                names = os.listdir(d)
            except OSError:
                continue
            for name in names:
                if name.startswith(".") and name.endswith(".tmp"):
                    _remove(os.path.join(d, name))
        self.prune_trash()

    def prune_trash(self):
        """Trash older than TRASH_DAYS, dated by when it was thrown away, not
        by the file's own age (a chat untouched for a year and deleted today
        stays). At start and every hour: a server left running for weeks kept
        everything it ever threw away."""
        cutoff = _now_ms() - TRASH_DAYS * 86400 * 1000
        d = os.path.join(self.root, "trash")
        for name in os.listdir(d):
            try:
                when = int(name.split("-", 1)[0])
            except ValueError:
                continue
            if when < cutoff:
                try:
                    os.remove(os.path.join(d, name))
                except OSError:
                    pass

    def _trash(self, kind, rid, src=None, move=True):
        src = src or self.path(kind, rid)
        if not os.path.exists(src):
            return
        dst = os.path.join(self.root, "trash", "%d-%s-%s.json" % (_now_ms(), kind, rid))
        try:
            if move:
                os.replace(src, dst)
            else:
                raw = self._read(src)
                if raw is not None:
                    _write_atomic(dst, raw)
        except OSError:
            pass

    def keep_in_trash(self, kind, rid, body):
        dst = os.path.join(self.root, "trash", "%d-%s-%s.json" % (_now_ms(), kind, rid))
        _write_atomic(dst, b'{"rev":0,"data":' + body + b"}")

    # ---------- one record ----------
    def get(self, kind, rid):
        with self.lock:
            if rid not in self.revs[kind]:
                return None
            return self._read(self.path(kind, rid))

    def load(self, kind, rid):
        raw = self.get(kind, rid)
        if raw is None:
            return None
        try:
            return json.loads(raw.decode("utf-8")).get("data")
        except (ValueError, UnicodeDecodeError, AttributeError):
            return None

    def put(self, kind, rid, body, base, client):
        with self.lock:
            cur = self.revs[kind].get(rid, 0)
            if base != cur:
                if base and not cur:
                    return 410, None                       # deleted since that tab read it
                return 409, self._read(self.path(kind, rid))  # newer than that tab knows
            rev = cur + 1
            # who wrote it rides along (after the data, where the revision scan never looks): a tab
            # whose save was taken but never answered meets its own write in the 409, and knows it
            _write_atomic(self.path(kind, rid), b'{"rev":%d,"data":' % rev + body + b',"by":' + json.dumps(client).encode("utf-8") + b"}")
            self.revs[kind][rid] = rev
        self.announce({"kind": kind, "id": rid, "rev": rev, "op": "put", "by": client})
        return 200, rev

    def delete(self, kind, rid, client):
        with self.lock:
            had = rid in self.revs[kind]
            self._trash(kind, rid)
            self.revs[kind].pop(rid, None)
            if kind == "chat":
                with self.sent_lock:
                    self._trash("sent", rid, self.sent_path(rid))
        if had:
            self.announce({"kind": kind, "id": rid, "op": "del", "by": client})
        return had

    def clear(self, kind, client):
        with self.lock:
            for rid in list(self.revs[kind]):
                self._trash(kind, rid)
                if kind == "chat":
                    with self.sent_lock:
                        self._trash("sent", rid, self.sent_path(rid))
                self.revs[kind].pop(rid, None)
        self.announce({"op": "reload", "by": client})

    # ---------- everything ----------
    def write_all(self, write):
        """Every record as it lies on disk, unparsed, handed to write() as it
        is read - one record in memory at a time. Joining them all first took
        twice the store's size at every app open (238 MB for a 107 MB store).
        Each record is read whole under the lock; saves go on in between."""
        with self.lock:
            ids = {kind: list(self.revs[kind]) for kind in DIRS}
            s = self._read(self.path("settings", "main")) if "main" in self.revs["settings"] else None
        write(b'{"id":' + json.dumps(self.meta["id"]).encode("utf-8") + b',"settings":')
        write(s if s else b"null")
        for kind, key in (("chat", b"chats"), ("file", b"files")):
            write(b',"' + key + b'":[')
            first = True
            for rid in ids[kind]:
                with self.lock:
                    raw = self._read(self.path(kind, rid)) if rid in self.revs[kind] else None
                if not raw:
                    continue
                if not first:
                    write(b",")
                write(raw)
                first = False
                raw = None
            write(b"]")
        write(b"}")

    def manifest(self):
        with self.lock:
            return {"id": self.meta["id"], "settings": self.revs["settings"].get("main", 0),
                    "chats": dict(self.revs["chat"]), "files": dict(self.revs["file"])}

    def _keep_old(self, kind, rid):
        """The version about to be replaced, kept in the trash first: linked,
        which takes no room, or copied where links are not to be had. A
        version that cannot be kept is not replaced - this raises."""
        src = self.path(kind, rid)
        if not os.path.exists(src):
            return None
        dst = os.path.join(self.root, "trash", "%d-%s-%s.json" % (_now_ms(), kind, rid))
        try:
            os.link(src, dst)
        except OSError:
            raw = self._read(src)
            if raw is None:
                raise
            _write_atomic(dst, raw)
        return dst

    def _write_new(self, kind, rid, rec):
        cur = self.revs[kind].get(rid, 0)
        if cur:
            self._keep_old(kind, rid)             # the version being replaced is kept
        _write_atomic(self.path(kind, rid), b'{"rev":%d,"data":' % (cur + 1) + _dump(rec) + b"}")
        self.revs[kind][rid] = cur + 1

    def import_merge(self, data, client):
        """Chats, files and settings from somewhere else - a browser that kept
        them before the phone did, or the old cozy-vault.json - joined with
        what the phone has. A chat the phone lacks is added; one it has is
        replaced only by a newer copy; settings gain what they lack."""
        report = {"chats": {"added": 0, "updated": 0, "kept": 0},
                  "files": {"added": 0, "updated": 0, "kept": 0}, "settings": "none"}
        try:
            self._import(data, report)
        finally:
            # whatever was added before a write failed (the phone out of room) is told to every tab
            self.announce({"op": "reload", "by": client})
        return report

    def _import(self, data, report):
        with self.lock:
            for kind, key in (("chat", "chats"), ("file", "files")):
                for rec in data.get(key) or []:
                    if not isinstance(rec, dict):
                        continue
                    rid = str(rec.get("id") or "")
                    if not ID_RE.match(rid):
                        continue
                    if rid not in self.revs[kind]:
                        self._write_new(kind, rid, rec)
                        report[key]["added"] += 1
                    elif _stamp(rec) > _stamp(self.load(kind, rid)):
                        self._write_new(kind, rid, rec)
                        report[key]["updated"] += 1
                    else:
                        report[key]["kept"] += 1
            s = data.get("settings")
            if isinstance(s, dict) and s and "main" in self.revs["settings"]:
                # whatever the merge keeps, the settings that arrived are kept whole too
                dst = os.path.join(self.root, "imported")
                os.makedirs(dst, exist_ok=True)
                _write_atomic(os.path.join(dst, "settings-%d.json" % _now_ms()), _dump(s))
            if isinstance(s, dict) and s:
                if "main" not in self.revs["settings"]:
                    merged, changed, report["settings"] = s, True, "adopted"
                else:
                    merged, changed = _merge_settings(self.load("settings", "main") or {}, s)
                    report["settings"] = "merged" if changed else "kept"
                if changed:
                    self._write_new("settings", "main", merged)

    def replace_all(self, data, client):
        """Restore from a backup file: what the file holds becomes what the
        phone holds. Everything it replaces goes to the trash first. Every new
        version is written (beside the old one) before any is put in place,
        and what follows is renames alone: a phone without room for all of
        it refuses the restore and changes nothing."""
        # a record that could not be kept is refused with the whole file, not
        # dropped from it in silence while everything else is replaced
        for key, what in (("conversations", "conversation"), ("docs", "file")):
            seen = set()
            for i, r in enumerate(data.get(key) if isinstance(data.get(key), list) else []):
                if not isinstance(r, dict):
                    raise ValueError("%s %d isn't one" % (what, i + 1))
                rid = r.get("id")
                if not isinstance(rid, str) or not ID_RE.match(rid):
                    raise ValueError("%s %d has no usable id" % (what, i + 1))
                if rid in seen:
                    raise ValueError("two %ss share the id %s" % (what, rid))
                seen.add(rid)
        with self.lock:
            plan, gone = [], []
            for kind, key in (("chat", "conversations"), ("file", "docs")):
                if not isinstance(data.get(key), list):
                    continue    # an older backup carries no files: the files here stay
                incoming = data[key]
                keep = {str(r["id"]) for r in incoming}
                gone += [(kind, rid) for rid in list(self.revs[kind]) if rid not in keep]
                plan += [(kind, str(r["id"]), r) for r in incoming]
            if isinstance(data.get("settings"), dict):
                plan.append(("settings", "main", data["settings"]))
            staged, kept = [], []
            try:
                for kind, rid, rec in plan:
                    rev = self.revs[kind].get(rid, 0) + 1
                    if rev > 1:
                        kept.append(self._keep_old(kind, rid))
                    staged.append((kind, rid, rev, _write_tmp(self.path(kind, rid), b'{"rev":%d,"data":' % rev + _dump(rec) + b"}")))
            except BaseException:
                for x in staged:
                    _remove(x[3])
                for k in kept:
                    if k:
                        _remove(k)
                raise
            for kind, rid in gone:
                self._trash(kind, rid)
                if kind == "chat":
                    with self.sent_lock:
                        self._trash("sent", rid, self.sent_path(rid))
                self.revs[kind].pop(rid, None)
            for kind, rid, rev, tmp in staged:
                os.replace(tmp, self.path(kind, rid))
                self.revs[kind][rid] = rev
            for d in {os.path.dirname(self.path(x[0], x[1])) for x in staged}:
                _fsync_dir(d)
        self.announce({"op": "reload", "by": client})

    def usage(self):
        """What the store takes on the phone - every folder it writes,
        the daily copies and what was handed over (imported/) included."""
        parts, total = {}, 0
        for sub in ("chats", "files", "sent", "trash", "backups", "imported"):
            d = os.path.join(self.root, sub)
            n = size = 0
            try:
                names = os.listdir(d)
            except OSError:
                names = []
            for name in names:
                try:
                    size += os.path.getsize(os.path.join(d, name))
                    n += 1
                except OSError:
                    pass
            parts[sub] = {"n": n, "bytes": size}
            total += size
        try:
            total += os.path.getsize(self.path("settings", "main"))
        except OSError:
            pass
        return {"dataDir": self.root, "bytes": total, "parts": parts}

    # ---------- what the model saw ----------
    def sent_keep(self, chat, sid, rec, pieces):
        with self.sent_lock:
            p = self.sent_path(chat)
            raw = self._read(p)
            box = None
            if raw:
                try:
                    box = json.loads(raw.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    box = None
            if not isinstance(box, dict):
                box = {}
            box.setdefault("pieces", {})
            box.setdefault("records", {})
            for k, t in (pieces or {}).items():
                if isinstance(k, str) and isinstance(t, str):
                    box["pieces"][k] = t
            box["records"][sid] = {"ts": _now_ms(), "rec": rec}
            recs = box["records"]
            if len(recs) > SENT_KEEP:
                for old in sorted(recs, key=lambda x: recs[x].get("ts", 0))[: len(recs) - SENT_KEEP]:
                    del recs[old]
            used = set()
            _collect(recs, used)
            for k in [k for k in box["pieces"] if k not in used]:
                del box["pieces"][k]
            _write_atomic(p, _dump(box))

    def sent_get(self, chat, sid):
        with self.sent_lock:
            raw = self._read(self.sent_path(chat))
        if not raw:
            return None
        try:
            box = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        r = (box.get("records") or {}).get(sid)
        if not isinstance(r, dict):
            return None
        used = set()
        _collect(r.get("rec"), used)
        pieces = box.get("pieces") or {}
        return {"rec": r.get("rec"), "pieces": {k: pieces[k] for k in used if k in pieces}}

    # ---------- every open tab hears every change ----------
    def announce(self, ev):
        line = ("data: " + json.dumps(ev) + "\n\n").encode("utf-8")
        with self.llock:
            for q in list(self.listeners):
                try:
                    q.put_nowait(line)
                except queue.Full:
                    # a tab that cannot keep up is cut off, so it reconnects
                    # and reads the manifest instead of missing changes
                    self.listeners.remove(q)
                    q.dead = True


STORE = None


# ---------- a copy of everything, once a day ----------
def _backup_dir():
    d = os.path.join(STORE.root, "backups")
    os.makedirs(d, exist_ok=True)
    return d


def _data_span(raw):
    """Where a record's data lies in its file ({"rev":N,"data":{...}} with
    who wrote it after, ',"by":"..."'), found without parsing it; None for a
    file that is not whole."""
    m = HEAD_RE.match(raw or b"")
    if not m or not raw.endswith(b"}"):
        return None
    end = len(raw) - 1
    if raw[end - 1:end] == b'"':                    # ,"by":"<who>" before the closing brace
        i = raw.rfind(b',"by":', m.end(), end)
        if i < 0:
            return None
        end = i
    if raw[m.end():m.end() + 1] != b"{" or raw[end - 1:end] != b"}":
        return None
    return m.end(), end


def make_backup(force=False):
    """Today's copy of everything, in the same shape as the app's Back up file
    (gzipped), so any copy can be brought back whole. The newest BACKUP_KEEP
    stay. Nothing is written while there is nothing to keep. It is written as
    it is read: each record goes from its file straight into the gzip, so the
    copy holds one record in memory at a time - joining and parsing the whole
    store first took four and a half times its size (482 MB for a 107 MB
    store), at every start and every hour. A record whose file is not whole
    is left out, not the whole copy."""
    d = _backup_dir()
    name = "cozy-%s.json.gz" % time.strftime("%Y-%m-%d")
    path = os.path.join(d, name)
    if os.path.exists(path) and not force:
        return name
    with STORE.lock:
        ids = {kind: list(STORE.revs[kind]) for kind in DIRS}
        settings = STORE._read(STORE.path("settings", "main")) if "main" in STORE.revs["settings"] else None
    span = _data_span(settings)
    if not ids["chat"] and not ids["file"] and not span:
        return None
    tmp = os.path.join(d, "." + name + "." + uuid.uuid4().hex[:8] + ".tmp")
    try:
        with open(tmp, "wb") as out:
            with gzip.GzipFile(filename="", mode="wb", compresslevel=6, fileobj=out) as gz:
                gz.write(b'{"app":"cozy-chat","kind":"backup","version":' + _dump(_app_version())
                         + b',"exportedAt":' + _dump(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())) + b',"settings":')
                gz.write(memoryview(settings)[span[0]:span[1]] if span else b"null")
                for kind, key in (("chat", b"conversations"), ("file", b"docs")):
                    gz.write(b',"' + key + b'":[')
                    first = True
                    for rid in ids[kind]:
                        with STORE.lock:          # one record at a time: saves go on meanwhile
                            raw = STORE._read(STORE.path(kind, rid)) if rid in STORE.revs[kind] else None
                        at = _data_span(raw)
                        if at:
                            if not first:
                                gz.write(b",")
                            gz.write(memoryview(raw)[at[0]:at[1]])
                            first = False
                        raw = None
                    gz.write(b"]")
                gz.write(b"}")
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    except BaseException:
        _remove(tmp)
        raise
    _fsync_dir(d)
    names = sorted(n for n in os.listdir(d) if BACKUP_RE.match(n))
    for old in names[:-BACKUP_KEEP]:
        try:
            os.remove(os.path.join(d, old))
        except OSError:
            pass
    return name


def list_backups():
    d = _backup_dir()
    out = []
    for n in sorted((n for n in os.listdir(d) if BACKUP_RE.match(n)), reverse=True):
        try:
            st = os.stat(os.path.join(d, n))
        except OSError:
            continue
        out.append({"name": n, "bytes": st.st_size, "when": int(st.st_mtime * 1000)})
    return {"keep": BACKUP_KEEP, "copies": out}


def restore_backup(name, client):
    if not BACKUP_RE.match(name or ""):
        return False
    try:
        with open(os.path.join(_backup_dir(), name), "rb") as f:
            blob = json.loads(gzip.decompress(f.read()).decode("utf-8"))
    except (OSError, ValueError, EOFError):
        return False
    if not isinstance(blob, dict) or not isinstance(blob.get("conversations"), list):
        return False
    STORE.replace_all(blob, client)     # what it replaces goes to the trash first
    return True


# ---------- Hermes' gateway key ----------
# Cozy's Hermes connection holds a copy of Hermes' API_SERVER_KEY. When Hermes
# gets a new key (a newer Hermes refuses short or placeholder keys and makes
# you set a strong one), the copy goes stale and every message is refused
# with 401. The real key is in Hermes' own files on this phone - in Termux, or
# in a proot distro's root - so each candidate is tried against Hermes
# itself, and only a key Hermes accepts is ever saved on the connection.
ENV_LINE = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$')


def _hermes_homes():
    out = [h for h in (os.environ.get("COZY_HERMES_HOME"), os.environ.get("HERMES_HOME"), "~/.hermes") if h]
    out = [os.path.abspath(os.path.expanduser(h)) for h in out]
    rootfs = os.path.join(os.environ.get("PREFIX") or "/data/data/com.termux/files/usr",
                          "var", "lib", "proot-distro", "installed-rootfs")
    out += sorted(glob.glob(os.path.join(rootfs, "*", "root", ".hermes")))
    out += sorted(glob.glob(os.path.join(rootfs, "*", "home", "*", ".hermes")))
    seen = []
    for h in out:
        if h not in seen and os.path.isdir(h):
            seen.append(h)
    return seen


def _env_values(path):
    vals = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = ENV_LINE.match(line)
                if m:
                    v = m.group(2)
                    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                        v = v[1:-1]
                    vals[m.group(1)] = v
    except OSError:
        pass
    return vals


def _hermes_keys():
    keys, ports = [], {8642}
    for h in _hermes_homes():
        for e in [os.path.join(h, ".env")] + sorted(glob.glob(os.path.join(h, "profiles", "*", ".env"))):
            v = _env_values(e)
            if v.get("API_SERVER_KEY"):
                keys.append(v["API_SERVER_KEY"])
            if str(v.get("API_SERVER_PORT", "")).isdigit():
                ports.add(int(v["API_SERVER_PORT"]))
        try:
            with open(os.path.join(h, "config.yaml"), encoding="utf-8", errors="replace") as f:
                keys += re.findall(r'(?m)^\s*key:\s*["\']?([^\s"\'#]{16,})', f.read())
        except OSError:
            pass
    out = []
    for k in keys:
        if k not in out:
            out.append(k)
    return out, ports


def _probe(base, key):
    req = urllib.request.Request(base.rstrip("/") + "/models", headers={"Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=4) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def sync_hermes_key():
    keys, ports = _hermes_keys()
    if not keys:
        return {"found": False, "changed": False}
    rev0 = STORE.revs["settings"].get("main", 0)
    s = STORE.load("settings", "main")
    if not isinstance(s, dict):
        return {"found": True, "changed": False}
    changed = False
    for p in s.get("providers") or []:
        if not isinstance(p, dict):
            continue
        u = urllib.parse.urlsplit(str(p.get("url") or ""))
        try:
            port = u.port or (443 if u.scheme == "https" else 80)
        except ValueError:
            continue
        hermes_like = p.get("preset") == "hermes" or str(p.get("model") or "") == "hermes-agent" or port in ports
        if u.hostname not in ("127.0.0.1", "localhost", "::1") or not hermes_like:
            continue
        base = str(p.get("url"))
        if _probe(base, str(p.get("apiKey") or "")) in (200, None):
            continue                        # already right, or Hermes is not up to ask
        for k in keys:
            if k != p.get("apiKey") and _probe(base, k) == 200:
                p["apiKey"] = k
                changed = True
                break
    if not changed:
        return {"found": True, "changed": False}
    with STORE.lock:
        if STORE.revs["settings"].get("main", 0) != rev0:
            return {"found": True, "changed": False}     # a tab wrote meanwhile: the next look settles it
        STORE._write_new("settings", "main", s)
        rev = STORE.revs["settings"]["main"]
    STORE.announce({"kind": "settings", "id": "main", "rev": rev, "op": "put", "by": "server"})
    return {"found": True, "changed": True}


def _hermes_key_watch():
    def loop():
        while True:
            try:
                sync_hermes_key()
            except Exception:
                pass
            time.sleep(float(os.environ.get("COZY_HERMES_SYNC_SECONDS") or 20))
    threading.Thread(target=loop, daemon=True).start()


def _every_hour():
    """Today's copy of everything (once a day), and the trash pruned - at start
    and every hour after (COZY_HOURLY_SECONDS)."""
    def loop():
        while True:
            for job in (make_backup, STORE.prune_trash):
                try:
                    job()
                except Exception:
                    pass
            time.sleep(float(os.environ.get("COZY_HOURLY_SECONDS") or 3600))
    threading.Thread(target=loop, daemon=True).start()


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the log file small; errors still surface

    def _drop_revalidation(self):
        # Without this the parent class still answers 304 Not Modified and the
        # browser keeps its old copy, which is the whole problem.
        for h in ("If-Modified-Since", "If-None-Match"):
            while h in self.headers:
                del self.headers[h]

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if n <= 0 or n > MAX_BODY:
            return None
        chunks, left = [], n
        while left > 0:
            c = self.rfile.read(min(left, 1 << 20))
            if not c:
                return None
            chunks.append(c)
            left -= len(c)
        return b"".join(chunks)

    def _json_body(self):
        raw = self._body()
        if raw is None:
            return None, None
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return raw, None
        return raw, obj

    def _client(self):
        return (self.headers.get("X-Cozy-Client") or "")[:64]

    def _from_app(self):
        """A write has to come from the app, which names itself in
        X-Cozy-Client. No other web page can put that header on a request to
        this server: a custom header needs a preflight, and this server grants
        none. Without the check, any site open in the phone's browser could
        clear or replace every chat with one fetch() whose answer it never
        even needs to read."""
        if self._client():
            return True
        self._refuse(403, "a write needs the X-Cozy-Client header")
        return False

    def _ours(self):
        """Only this phone's own names reach this server. A web page can point
        its own domain name at 127.0.0.1 (DNS rebinding); the browser then
        takes that page for this server's own origin, so it could read every
        chat and key, and send X-Cozy-Client as the app does. Its requests
        still carry its name in Host, though, and its writes its Origin."""
        bound, port = self.server.server_address[:2]
        name, p = _host_port(self.headers.get("Host"))
        ok = name is not None and p == port and _own_name(name, bound)
        if ok and self.command in ("PUT", "POST", "DELETE"):
            origin = self.headers.get("Origin")
            if origin is not None:
                u = urllib.parse.urlsplit(origin.strip().lower())
                try:
                    oport = u.port or 80
                except ValueError:
                    oport = None
                ok = u.scheme == "http" and _own_name(u.hostname or "", bound) and oport == port
        if not ok:
            self._refuse(403, "this server answers only to this phone's own addresses (127.0.0.1, localhost)")
        return ok

    def _failed(self, e):
        """A write the phone could not make: said, not a dropped connection
        (which the app could only take for a server that isn't running)."""
        if getattr(e, "errno", None) in FULL:
            return self._json(507, {"error": "the phone's storage is full"})
        return self._json(500, {"error": "the phone couldn't write it (%s)" % (getattr(e, "strerror", None) or e)})

    def _refuse(self, code, why):
        # what was sent is read first (up to a megabyte): closing on a body
        # nobody read resets the connection, and the answer is lost with it
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if 0 < n <= (1 << 20):
            self.rfile.read(n)
        self._json(code, {"error": why})

    @staticmethod
    def _hidden(path):
        """The server's own files are not the app's: a dot-file (its pid, its
        log, .git) or the old vault. Read on the decoded path - an escaped
        dot (%2E) names the same file."""
        segs = [s for s in urllib.parse.unquote(path).split("/") if s]
        return any(s.startswith(".") for s in segs) or (bool(segs) and segs[-1].startswith("cozy-vault"))

    @staticmethod
    def _ok(kind, rid):
        if kind == "settings":
            return rid == "main"
        return kind in DIRS and bool(ID_RE.match(rid))

    def _serve_index(self):
        # The app learns its data lives on this phone from this tag - no tag,
        # and it never makes a store request at all.
        try:
            with open(os.path.join(ROOT, "index.html"), "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        if MARKER not in body:
            if b"</head>" in body:
                body = body.replace(b"</head>", b"  " + MARKER + b"\n</head>", 1)
            else:
                body = body + b"\n" + MARKER + b"\n"
        self._send(200, body, "text/html; charset=utf-8")

    def _events(self):
        q = queue.Queue(maxsize=5000)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        with STORE.llock:
            STORE.listeners.append(q)
        try:
            self.wfile.write(b"retry: 2000\n: hello\n\n")
            self.wfile.flush()
            while not getattr(q, "dead", False):
                try:
                    line = q.get(timeout=15)
                except queue.Empty:
                    line = b": ping\n\n"
                self.wfile.write(line)
                self.wfile.flush()
        except OSError:
            pass
        finally:
            with STORE.llock:
                if q in STORE.listeners:
                    STORE.listeners.remove(q)

    def _parts(self):
        path = self.path.split("?", 1)[0]
        return path, [p for p in path.split("/") if p]

    def do_GET(self):
        if not self._ours():
            return
        self._drop_revalidation()
        path, parts = self._parts()
        if path in ("/", "/index.html"):
            return self._serve_index()
        if path == "/api/backup/list":
            return self._json(200, list_backups())
        if path == "/api/version":
            return self._json(200, {"app": "cozy-chat", "version": _app_version(), "code": CODE, "store": 2})
        if parts[:2] == ["api", "store"]:
            rest = parts[2:]
            if rest == ["hello"]:
                return self._json(200, {"app": "cozy-chat", "store": 2, "id": STORE.meta["id"],
                                        "dataDir": STORE.root, "version": _app_version()})
            if rest == ["all"]:
                # sent as it is read, with no length up front: the answer ends when the connection does (HTTP/1.0)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                STORE.write_all(self.wfile.write)
                return
            if rest == ["manifest"]:
                return self._json(200, STORE.manifest())
            if rest == ["usage"]:
                return self._json(200, STORE.usage())
            if rest == ["events"]:
                return self._events()
            if len(rest) == 2 and self._ok(rest[0], rest[1]):
                raw = STORE.get(rest[0], rest[1])
                if raw is None:
                    return self._json(404, {"error": "no such record"})
                return self._send(200, raw)
            return self._json(404, {"error": "not found"})
        if parts[:2] == ["api", "sent"] and len(parts) == 4 and ID_RE.match(parts[2]) and ID_RE.match(parts[3]):
            got = STORE.sent_get(parts[2], parts[3])
            if got is None:
                return self._json(404, {"error": "not kept"})
            return self._send(200, _dump(got))
        if path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        if self._hidden(path):
            return self._json(404, {"error": "not found"})    # the server's own files are not the app's
        super().do_GET()

    def do_HEAD(self):
        if not self._ours():
            return
        self._drop_revalidation()
        if self._hidden(self._parts()[0]):
            return self._json(404, {"error": "not found"})
        super().do_HEAD()

    def do_PUT(self):
        if not self._ours() or not self._from_app():
            return
        path, parts = self._parts()
        if parts[:2] == ["api", "store"] and len(parts) == 4 and self._ok(parts[2], parts[3]):
            raw, obj = self._json_body()
            if raw is None:
                return self._json(400, {"error": "empty or too large"})
            if not isinstance(obj, dict):
                # a body that is not a record is a bug, not a smaller record -
                # it must never replace the one on disk
                return self._json(400, {"error": "not a record"})
            try:
                base = int(self.headers.get("X-Cozy-Base") or 0)
            except ValueError:
                return self._json(400, {"error": "bad base"})
            try:
                code, val = STORE.put(parts[2], parts[3], raw.strip(), base, self._client())
            except OSError as e:
                return self._failed(e)
            if code == 200:
                return self._json(200, {"rev": val})
            if code == 410:
                return self._json(410, {"error": "deleted"})
            return self._send(409, val or b"null")
        if parts[:2] == ["api", "sent"] and len(parts) == 4 and ID_RE.match(parts[2]) and ID_RE.match(parts[3]):
            raw, obj = self._json_body()
            if not isinstance(obj, dict) or not isinstance(obj.get("pieces", {}), dict):
                return self._json(400, {"error": "not a sent record"})
            try:
                STORE.sent_keep(parts[2], parts[3], obj.get("rec"), obj.get("pieces") or {})
            except OSError as e:
                return self._failed(e)
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if not self._ours() or not self._from_app():
            return
        path, parts = self._parts()
        if parts[:2] == ["api", "store"] and len(parts) == 4 and self._ok(parts[2], parts[3]) and parts[2] != "settings":
            had = STORE.delete(parts[2], parts[3], self._client())
            return self._json(200, {"ok": True, "had": had})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._ours() or not self._from_app():
            return
        try:
            self._post()
        except OSError as e:
            if isinstance(e, (ConnectionError, TimeoutError)):
                raise                      # the tab went away: nobody to answer
            self._failed(e)

    def _post(self):
        path, parts = self._parts()
        if path == "/api/hermes/sync":
            return self._json(200, sync_hermes_key())
        if path == "/api/backup/now":
            name = make_backup(force=True)
            return self._json(200 if name else 409, {"name": name} if name else {"error": "nothing to keep yet"})
        if parts[:3] == ["api", "backup", "restore"] and len(parts) == 4:
            try:
                ok = restore_backup(parts[3], self._client())
            except ValueError as e:
                return self._json(400, {"error": "that copy can't be brought back: " + str(e)})
            return self._json(200 if ok else 404, {"ok": ok})
        if path in ("/api/store/import", "/api/store/replace"):
            raw, obj = self._json_body()
            if not isinstance(obj, dict):
                return self._json(400, {"error": "not an import"})
            if path.endswith("import"):
                return self._json(200, STORE.import_merge(obj, self._client()))
            try:
                STORE.replace_all(obj, self._client())
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            return self._json(200, {"ok": True})
        if parts[:3] == ["api", "store", "clear"] and len(parts) == 4 and parts[3] in DIRS:
            STORE.clear(parts[3], self._client())
            return self._json(200, {"ok": True})
        if parts[:3] == ["api", "store", "trash"] and len(parts) == 5 and self._ok(parts[3], parts[4]):
            raw, obj = self._json_body()
            if not isinstance(obj, dict):
                return self._json(400, {"error": "not a record"})
            STORE.keep_in_trash(parts[3], parts[4], raw.strip())
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not found"})


def _import_vault():
    """The vault the app kept before (one blob next to the app) joins the
    store once, then moves out of the folder the server serves."""
    src = os.path.join(ROOT, "cozy-vault.json")
    if not os.path.exists(src):
        return
    try:
        with open(src, "rb") as f:
            blob = json.loads(f.read().decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return
    if not isinstance(blob, dict):
        return
    STORE.import_merge({"settings": blob.get("settings"), "chats": blob.get("conversations"),
                        "files": blob.get("docs")}, "server")
    dst = os.path.join(STORE.root, "imported")
    os.makedirs(dst, exist_ok=True)
    try:
        os.replace(src, os.path.join(dst, "cozy-vault-%d.json" % _now_ms()))
    except OSError:
        pass


def _watch_self():
    """An update that replaces this file relights the server on its own, so
    a server started before the update never keeps serving the old code."""
    def loop():
        try:
            seen = os.path.getmtime(SELF)
        except OSError:
            return
        while True:
            time.sleep(2)
            try:
                now = os.path.getmtime(SELF)
            except OSError:
                continue
            if now == seen:
                continue
            seen = now
            time.sleep(0.6)    # let the update finish writing
            if _code_stamp() not in ("", CODE):
                os.execv(sys.executable, [sys.executable, SELF] + sys.argv[1:])
    threading.Thread(target=loop, daemon=True).start()


def _hold_folder(port, bind):
    """One server per data folder, for as long as it runs. Each server keeps
    its own revision numbers, so two on the same folder (cozy on 8787, bash
    serve.sh on another port) each took the other's saves for current and
    wrote over them. The second one stops at once and says where the first
    one is. The lock goes with the process, however it ends; an update that
    relights the server (execv) lets go of it and takes it again."""
    os.makedirs(DATA_DIR, exist_ok=True)
    fd = os.open(os.path.join(DATA_DIR, ".server.lock"), os.O_RDWR | os.O_CREAT, 0o600)
    if fcntl is None:
        return fd
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as e:
        if e.errno not in (errno.EWOULDBLOCK, errno.EAGAIN):
            return fd                       # a disk that cannot lock: carry on unheld
        try:
            held = os.read(fd, 200).decode("utf-8", "replace").strip()
        except OSError:
            held = ""
        os.close(fd)
        where = held.rsplit(":", 1)
        sys.stderr.write("Cozy's server for %s is already running%s, so this one stops.\n"
                         % (DATA_DIR, (" on port %s (http://%s/)" % (where[-1], held)) if held else ""))
        sys.exit(3)
    os.ftruncate(fd, 0)
    os.write(fd, ("%s:%d" % ("127.0.0.1" if bind in ("0.0.0.0", "", "::") else bind, port)).encode("utf-8"))
    return fd


def main():
    global STORE
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    bind = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    _hold_folder(port, bind)
    STORE = Store(DATA_DIR)
    STORE.tidy()
    _import_vault()
    _every_hour()
    _hermes_key_watch()
    srv = ThreadingHTTPServer((bind, port), NoCacheHandler)
    srv.daemon_threads = True
    _watch_self()
    srv.serve_forever()


if __name__ == "__main__":
    main()
