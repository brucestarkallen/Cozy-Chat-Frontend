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
import gzip
import hashlib
import json
import os
import queue
import re
import sys
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

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


def _write_atomic(path, payload):
    """The whole file or none of it: a write that dies halfway leaves the old
    file exactly as it was."""
    d = os.path.dirname(path)
    tmp = os.path.join(d, "." + os.path.basename(path) + "." + uuid.uuid4().hex[:8] + ".tmp")
    with open(tmp, "wb") as f:
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    _fsync_dir(d)


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


def _merge_settings(cur, inc):
    """Settings from somewhere else meet the ones on the phone: every
    connection, instruction set, saved prompt and project the phone does not
    have yet is added; everything the phone already has stays as it is."""
    out = dict(cur)
    changed = False
    for key in ("providers", "presets", "prompts", "projects"):
        mine = out.get(key) if isinstance(out.get(key), list) else []
        theirs = inc.get(key) if isinstance(inc.get(key), list) else []
        have = {x.get("id") for x in mine if isinstance(x, dict)}
        add = [x for x in theirs if isinstance(x, dict) and x.get("id") and x.get("id") not in have]
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
        """Half-written temp files from a write that died, and trash older
        than TRASH_DAYS (dated by when it was thrown away, not by the file's
        own age - a chat untouched for a year and deleted today stays)."""
        for sub in ("chats", "files", "sent", ""):
            d = os.path.join(self.root, sub)
            for name in os.listdir(d):
                if name.startswith(".") and name.endswith(".tmp"):
                    try:
                        os.remove(os.path.join(d, name))
                    except OSError:
                        pass
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
            _write_atomic(self.path(kind, rid), b'{"rev":%d,"data":' % rev + body + b"}")
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
    def dump_all(self):
        """Every record as it lies on disk, joined without being parsed."""
        with self.lock:
            out = [b'{"id":', json.dumps(self.meta["id"]).encode("utf-8"), b',"settings":']
            s = self._read(self.path("settings", "main")) if "main" in self.revs["settings"] else None
            out.append(s if s else b"null")
            for kind, key in (("chat", b"chats"), ("file", b"files")):
                out.append(b',"' + key + b'":[')
                first = True
                for rid in list(self.revs[kind]):
                    raw = self._read(self.path(kind, rid))
                    if not raw:
                        continue
                    if not first:
                        out.append(b",")
                    out.append(raw)
                    first = False
                out.append(b"]")
            out.append(b"}")
            return b"".join(out)

    def manifest(self):
        with self.lock:
            return {"id": self.meta["id"], "settings": self.revs["settings"].get("main", 0),
                    "chats": dict(self.revs["chat"]), "files": dict(self.revs["file"])}

    def _write_new(self, kind, rid, rec):
        cur = self.revs[kind].get(rid, 0)
        if cur:
            self._trash(kind, rid, move=False)    # the version being replaced is kept
        _write_atomic(self.path(kind, rid), b'{"rev":%d,"data":' % (cur + 1) + _dump(rec) + b"}")
        self.revs[kind][rid] = cur + 1

    def import_merge(self, data, client):
        """Chats, files and settings from somewhere else - a browser that kept
        them before the phone did, or the old cozy-vault.json - joined with
        what the phone has. A chat the phone lacks is added; one it has is
        replaced only by a newer copy; settings gain what they lack."""
        report = {"chats": {"added": 0, "updated": 0, "kept": 0},
                  "files": {"added": 0, "updated": 0, "kept": 0}, "settings": "none"}
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
            if isinstance(s, dict) and s:
                if "main" not in self.revs["settings"]:
                    merged, changed, report["settings"] = s, True, "adopted"
                else:
                    merged, changed = _merge_settings(self.load("settings", "main") or {}, s)
                    report["settings"] = "merged" if changed else "kept"
                if changed:
                    self._write_new("settings", "main", merged)
        self.announce({"op": "reload", "by": client})
        return report

    def replace_all(self, data, client):
        """Restore from a backup file: what the file holds becomes what the
        phone holds. Everything it replaces goes to the trash first."""
        with self.lock:
            for kind, key in (("chat", "conversations"), ("file", "docs")):
                if not isinstance(data.get(key), list):
                    continue    # an older backup carries no files: the files here stay
                incoming = [r for r in data[key] if isinstance(r, dict) and ID_RE.match(str(r.get("id") or ""))]
                keep = {str(r["id"]) for r in incoming}
                for rid in list(self.revs[kind]):
                    if rid not in keep:
                        self._trash(kind, rid)
                        if kind == "chat":
                            with self.sent_lock:
                                self._trash("sent", rid, self.sent_path(rid))
                        self.revs[kind].pop(rid, None)
                for rec in incoming:
                    self._write_new(kind, str(rec["id"]), rec)
            if isinstance(data.get("settings"), dict):
                self._write_new("settings", "main", data["settings"])
        self.announce({"op": "reload", "by": client})

    def usage(self):
        parts, total = {}, 0
        for sub in ("chats", "files", "sent", "trash"):
            d = os.path.join(self.root, sub)
            n = size = 0
            for name in os.listdir(d):
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


def make_backup(force=False):
    """Today's copy of everything, in the same shape as the app's Back up file
    (gzipped), so any copy can be brought back whole. The newest BACKUP_KEEP
    stay. Nothing is written while there is nothing to keep."""
    d = _backup_dir()
    name = "cozy-%s.json.gz" % time.strftime("%Y-%m-%d")
    path = os.path.join(d, name)
    if os.path.exists(path) and not force:
        return name
    try:
        a = json.loads(STORE.dump_all().decode("utf-8"))   # read under the lock as raw bytes, parsed outside it
    except ValueError:
        return None
    if not a.get("chats") and not a.get("files") and not a.get("settings"):
        return None
    blob = {"app": "cozy-chat", "kind": "backup", "version": _app_version(),
            "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "settings": (a.get("settings") or {}).get("data"),
            "conversations": [r["data"] for r in a.get("chats") or [] if isinstance(r, dict)],
            "docs": [r["data"] for r in a.get("files") or [] if isinstance(r, dict)]}
    _write_atomic(path, gzip.compress(_dump(blob), 6))
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


def _daily_backups():
    def loop():
        while True:
            try:
                make_backup()
            except Exception:
                pass
            time.sleep(3600)
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
                return self._send(200, STORE.dump_all())
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
        name = os.path.basename(path.rstrip("/"))
        if name.startswith(".") or name.startswith("cozy-vault"):
            return self._json(404, {"error": "not found"})    # the server's own files are not the app's
        super().do_GET()

    def do_HEAD(self):
        self._drop_revalidation()
        super().do_HEAD()

    def do_PUT(self):
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
            code, val = STORE.put(parts[2], parts[3], raw.strip(), base, self._client())
            if code == 200:
                return self._json(200, {"rev": val})
            if code == 410:
                return self._json(410, {"error": "deleted"})
            return self._send(409, val or b"null")
        if parts[:2] == ["api", "sent"] and len(parts) == 4 and ID_RE.match(parts[2]) and ID_RE.match(parts[3]):
            raw, obj = self._json_body()
            if not isinstance(obj, dict) or not isinstance(obj.get("pieces", {}), dict):
                return self._json(400, {"error": "not a sent record"})
            STORE.sent_keep(parts[2], parts[3], obj.get("rec"), obj.get("pieces") or {})
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not found"})

    def do_DELETE(self):
        path, parts = self._parts()
        if parts[:2] == ["api", "store"] and len(parts) == 4 and self._ok(parts[2], parts[3]) and parts[2] != "settings":
            had = STORE.delete(parts[2], parts[3], self._client())
            return self._json(200, {"ok": True, "had": had})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        path, parts = self._parts()
        if path == "/api/backup/now":
            name = make_backup(force=True)
            return self._json(200 if name else 409, {"name": name} if name else {"error": "nothing to keep yet"})
        if parts[:3] == ["api", "backup", "restore"] and len(parts) == 4:
            ok = restore_backup(parts[3], self._client())
            return self._json(200 if ok else 404, {"ok": ok})
        if path in ("/api/store/import", "/api/store/replace"):
            raw, obj = self._json_body()
            if not isinstance(obj, dict):
                return self._json(400, {"error": "not an import"})
            if path.endswith("import"):
                return self._json(200, STORE.import_merge(obj, self._client()))
            STORE.replace_all(obj, self._client())
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


def main():
    global STORE
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    bind = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    STORE = Store(DATA_DIR)
    STORE.tidy()
    _import_vault()
    _daily_backups()
    srv = ThreadingHTTPServer((bind, port), NoCacheHandler)
    srv.daemon_threads = True
    _watch_self()
    srv.serve_forever()


if __name__ == "__main__":
    main()
