# TEST FILE - run with: python3 tests/v5291data_e2e.py
# The second round of data fixes after v5.28.9, proven in real Chromium
# against the real serve.py and a real streaming model on localhost.
# Separate browser contexts stand in for separate browsers; "another browser"
# writing is a write to the phone's store at its newest revision, as any
# browser that is up to date makes it. The browser-only half is
# tests/v5291datatest.js.
#   1. a browser that fell behind undoes nothing another browser did: a
#      rename, an archive, the chat's own settings, deleted messages, an
#      emptied chat - live (a 409) and when its journal is replayed; a copy is
#      made only when both changed the messages, and it drops nothing; a file
#      renamed in one browser and written in the other keeps both
#   2. a change queued behind a save the phone answered 409 is kept: settings,
#      a chat, a file - here and on the phone; a chat deleted here meanwhile
#      is not brought back
#   3. what the phone reloads (another browser's chats handed over, a copy
#      brought back, every chat deleted) is taken into the chats this tab
#      holds: a reply arriving meanwhile is not erased by the next message, a
#      rename on its way is merged with the copy, a reply into a chat deleted
#      elsewhere ends in the phone's trash; a message open in its editor stays
#      open through it, and through a setting changed elsewhere
#   4. a tab in the background lets go of its event stream (a browser gives
#      a server six connections): with six Cozy tabs in the background a
#      seventh opens and saves, and a tab back in view catches up and hears
#      changes again; a save with no answer in 15 s waits in the journal and
#      the banner says so, and when that save had reached the phone, what was
#      deleted after it is not brought back by it
#   5. a chat whose first save lands just after the phone's list was read
#      (or everything was read, for a reload) is read again, not removed with
#      its reply cut off; one really deleted on the phone still goes
# Needs: pip install playwright && playwright install chromium.
import base64, gzip, http.client, json, os, resource, shutil, signal, socket, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = tempfile.mkdtemp(prefix="cozy-v5291-")
HERMES_DIR = tempfile.mkdtemp(prefix="cozy-v5291-hermes-")
PORT = None
SRV = None
passed = failed = 0


def ck(name, ok, extra=""):
    global passed, failed
    print(("  ok   " if ok else "  FAIL ") + name + (("  -> " + str(extra)) if extra != "" else ""))
    if ok:
        passed += 1
    else:
        failed += 1


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def start(extra_env=None, preexec=None):
    global SRV
    env = dict(os.environ, COZY_DATA_DIR=DATA, COZY_HERMES_HOME=HERMES_DIR, COZY_HERMES_SYNC_SECONDS="3600")
    env.update(extra_env or {})
    SRV = subprocess.Popen([sys.executable, os.path.join(ROOT, "serve.py"), str(PORT), "127.0.0.1"], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True, preexec_fn=preexec)
    for _ in range(80):
        try:
            urllib.request.urlopen(base() + "/api/store/hello", timeout=0.5).read(); return
        except Exception:
            time.sleep(0.1)
    raise SystemExit("server did not start")


def stop():
    if SRV and SRV.poll() is None:
        os.killpg(SRV.pid, signal.SIGKILL); SRV.wait()


def base():
    return "http://127.0.0.1:%d" % PORT


def api(path, method="GET", body=None, headers=None):
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
    h = {"X-Cozy-Client": "test"} if method != "GET" else {}
    h.update(headers or {})
    r = urllib.request.Request(base() + path, method=method, data=body, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=10) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"null")
        except ValueError:
            return e.code, raw


def put(kind, rid, data, base_rev):
    return api("/api/store/%s/%s" % (kind, rid), "PUT", data, {"content-type": "application/json", "X-Cozy-Base": str(base_rev)})


def on_phone(kind, rid):
    st, j = api("/api/store/%s/%s" % (kind, rid))
    return j["data"] if st == 200 else None


def chat_on_phone(cid):
    return on_phone("chat", cid)


def elsewhere(kind, rid, change):
    """Another browser, up to date, changes the record: read at its newest revision, change, write."""
    st, r = api("/api/store/%s/%s" % (kind, rid))
    d = r["data"]; change(d)
    st, _ = put(kind, rid, d, r["rev"])
    assert st == 200, st


def said(c):
    return [m.get("content") for m in (c or {}).get("messages", [])]


def copies_of(title_part="this browser's copy"):
    out = []
    for kind, key in (("chat", "chats"), ("file", "files")):
        for i in api("/api/store/manifest")[1][key]:
            d = on_phone(kind, i) or {}
            if title_part in (d.get("title") or d.get("name") or ""):
                d["kind"] = kind
                out.append(d)
    return out


def named(cps):
    return [x.get("title") or x.get("name") for x in cps]


def drop_copies():
    for x in copies_of():
        api("/api/store/%s/%s" % (x["kind"], x["id"]), "DELETE")


class Model:
    """A model on localhost that streams: 'answer' replies at once; 'arrive'
    sends its first words, then nothing until release() or the request is
    called off - a reply still arriving."""
    def __init__(self):
        self.mode = "answer"
        self.port = free_port()
        self.gate = threading.Event()
        model = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *a): pass
            def _cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "*")
                self.send_header("Access-Control-Allow-Methods", "*")
            def do_OPTIONS(self):
                self.send_response(204); self._cors(); self.send_header("Content-Length", "0"); self.end_headers()
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                users = [m for m in body.get("messages", []) if m.get("role") == "user"]
                last = users[-1]["content"] if users else "?"
                if isinstance(last, list):
                    last = " ".join(p.get("text", "") for p in last if isinstance(p, dict))
                words = "Reply to: " + str(last).split("\n")[-1]
                self.send_response(200); self._cors()
                self.send_header("Content-Type", "text/event-stream"); self.send_header("Connection", "close"); self.end_headers()
                def chunk(t):
                    self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": t}}]}) + "\n\n").encode()); self.wfile.flush()
                try:
                    chunk(words[:9])
                    if model.mode == "arrive":
                        model.gate.clear()
                        while not model.gate.wait(0.2):
                            pass
                    chunk(words[9:])
                    self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
                except OSError:
                    pass
        self.srv = ThreadingHTTPServer(("127.0.0.1", self.port), H)
        self.srv.daemon_threads = True
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def url(self):
        return "http://127.0.0.1:%d/v1" % self.port

    def release(self):
        self.gate.set()


MODEL = Model()
SETTINGS = {"providers": [{"id": "p1", "preset": "custom", "kind": "openai", "name": "Mock", "url": MODEL.url(),
                           "apiKey": "k", "model": "mock-1", "ctx": 100000}],
            "activeProvider": "p1", "presets": [{"id": "d", "name": "D", "system": "BE KIND", "injections": [],
                                                  "order": ["__main__", "__chat__"]}],
            "activePreset": "d", "prompts": [], "projects": [], "temperature": 1, "maxTokens": 4096, "effort": "off",
            "squashSystem": True, "autoTitle": False, "theme": "dark", "seeded513": True,
            "search": {"on": False, "provider": "native", "key": "", "count": 5, "relay": "", "always": False}}


def open_app(ctx, url=None, block_events=False):
    page = ctx.new_page()
    if block_events:
        page.route("**/api/store/events*", lambda r: r.abort())
    page.goto(url or (base() + "/"))
    page.wait_for_function("typeof Device === 'object' && Device.isReady() && document.querySelector('#chatTitle')")
    page.wait_for_timeout(300)
    return page


def settle_down(page, ms=8000):
    """Until every save of the tab has been answered."""
    try:
        page.wait_for_function("() => Device.idle()", timeout=ms)
    except Exception:
        pass
    page.wait_for_timeout(300)


def send(page, text, timeout=8000):
    page.fill("#input", text)
    page.click("#sendBtn")
    page.wait_for_function("t => current && current.messages.some(m => m.role === 'assistant' && !m.pending && (m.content||'').indexOf(t) >= 0)",
                           arg="Reply to: " + text, timeout=timeout)
    settle_down(page)


def send_slowly(page, text, timeout=8000):
    """Send, with a reply that only starts arriving once the tab's own save of the message was answered."""
    MODEL.mode = "arrive"
    page.fill("#input", text)
    page.click("#sendBtn")
    page.wait_for_function("() => streaming && streaming.asstId", timeout=timeout)
    settle_down(page)
    MODEL.release()
    page.wait_for_function("t => current && current.messages.some(m => m.role === 'assistant' && !m.pending && (m.content||'').indexOf(t) >= 0)",
                           arg="Reply to: " + text, timeout=timeout)
    settle_down(page)
    MODEL.mode = "answer"


def start_arriving(page, text):
    """Send a message whose reply starts and then keeps arriving (until MODEL.release())."""
    MODEL.mode = "arrive"
    page.fill("#input", text)
    page.click("#sendBtn")
    page.wait_for_function("() => streaming && streaming.asstId && current.messages.slice(-1)[0].role === 'assistant'", timeout=8000)
    page.wait_for_timeout(400)


def finish_arriving(page):
    MODEL.release()
    page.wait_for_function("() => !streaming", timeout=8000)
    settle_down(page)
    MODEL.mode = "answer"


def open_chat(page, cid):
    page.click('#convoList [data-id="%s"]' % cid)
    page.wait_for_function("id => current && current.id === id", arg=cid)


def new_chat_with(page, *texts):
    MODEL.mode = "answer"
    page.evaluate("document.querySelector('#newChatBtn').click()")
    for t in texts:
        send(page, t)
    return page.evaluate("current.id")


def section1(br, mk):
        print("=== 1. A BROWSER THAT FELL BEHIND UNDOES NOTHING ANOTHER BROWSER DID ===")
        A = mk(); a = open_app(A)
        S = mk()                                                # the browser that fell behind: it hears nothing

        state = {"s": None}

        def stale_on(cid):
            s = state["s"]
            if s is None:
                s = state["s"] = open_app(S, block_events=True)
            else:
                s.reload(); s.wait_for_function("typeof Device === 'object' && Device.isReady()"); s.wait_for_timeout(300)
            open_chat(s, cid)
            return s

        # renamed, archived and given its own temperature in another browser; the stale tab sends
        cid = new_chat_with(a, "one", "two")
        elsewhere("chat", cid, lambda d: d.__setitem__("archived", False))     # archived once and put back in the list
        s = stale_on(cid)
        def renamed(d):
            d["title"] = "Renamed elsewhere"; d["archived"] = True; d.setdefault("cfg", {})["temperature"] = 0.25
        elsewhere("chat", cid, renamed)
        send_slowly(s, "three")
        c = chat_on_phone(cid)
        ck("renamed in another browser, the stale tab sends: the rename stays", c["title"] == "Renamed elsewhere", c["title"])
        ck("… so does the archive", c.get("archived") is True, c.get("archived"))
        ck("… and the chat's own setting set there (its temperature)", (c.get("cfg") or {}).get("temperature") == 0.25, c.get("cfg"))
        ck("… with the stale tab's message and its reply added", said(c) == ["one", "Reply to: one", "two", "Reply to: two", "three", "Reply to: three"], said(c))
        ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()
        ck("the stale tab now shows the other browser's name", s.evaluate("current.title") == "Renamed elsewhere", s.evaluate("current.title"))

        # the last exchange deleted in another browser; the stale tab renames
        cid = new_chat_with(a, "one", "two")
        s = stale_on(cid)
        elsewhere("chat", cid, lambda d: d.__setitem__("messages", d["messages"][:2]))
        s.once("dialog", lambda dlg: dlg.accept("Renamed in the stale tab"))
        s.click("#chatTitle")
        settle_down(s)
        c = chat_on_phone(cid)
        ck("the last exchange deleted in another browser, the stale tab renames: the deleted messages stay deleted",
           said(c) == ["one", "Reply to: one"], said(c))
        ck("… and the stale tab's name is taken", c["title"] == "Renamed in the stale tab", c["title"])
        ck("… and the stale tab no longer shows the deleted exchange", s.evaluate("current.messages.length") == 2, s.evaluate("current.messages.map(m => m.content)"))
        ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()

        # emptied in another browser; the stale tab pins it
        cid = new_chat_with(a, "one", "two")
        s = stale_on(cid)
        elsewhere("chat", cid, lambda d: d.__setitem__("messages", []))
        s.click('#convoList [data-id="%s"]' % cid, button="right")
        settle_down(s)
        c = chat_on_phone(cid)
        ck("emptied in another browser, the stale tab pins it: it stays empty", said(c) == [], said(c))
        ck("… and pinned", c.get("pinned") is True, c.get("pinned"))
        ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()

        # both changed the messages: the last exchange deleted there, a new one written here
        cid = new_chat_with(a, "one", "two")
        s = stale_on(cid)
        elsewhere("chat", cid, lambda d: d.__setitem__("messages", d["messages"][:2]))
        send_slowly(s, "three")
        c = chat_on_phone(cid)
        cps = copies_of()
        ck("both changed the messages: the phone's chat keeps what the other browser did", said(c) == ["one", "Reply to: one"], said(c))
        ck("… and the stale tab's version is a copy beside it, dropping nothing",
           len(cps) == 1 and said(cps[0]) == ["one", "Reply to: one", "two", "Reply to: two", "three", "Reply to: three"], [said(x) for x in cps])
        drop_copies()

        # a file renamed in another browser while the stale tab writes in it, and the other way round
        a.evaluate("newDoc('notes.md', 'first words')")
        settle_down(a)
        fid = a.evaluate("docs.find(d => d.name === 'notes.md').id")
        s = stale_on(cid)
        elsewhere("file", fid, lambda d: d.__setitem__("name", "renamed-elsewhere.md"))
        s.evaluate("id => openDocEditor(id)", fid)
        s.fill("#docEditArea", "written in the stale tab")
        s.click("#docSaveBtn")
        settle_down(s)
        f = on_phone("file", fid)
        ck("a file renamed in another browser and written in the stale tab keeps both: the name",
           f["name"] == "renamed-elsewhere.md", f["name"])
        ck("… and the words", f["text"] == "written in the stale tab", f["text"])
        ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()
        s.evaluate("hideDocEdit()")
        s = stale_on(cid)
        elsewhere("file", fid, lambda d: d.__setitem__("text", "rewritten elsewhere"))
        s.evaluate("id => openDocEditor(id)", fid)
        s.once("dialog", lambda dlg: dlg.accept("renamed-in-the-stale-tab.md"))
        s.click("#docRenameBtn")
        settle_down(s)
        f = on_phone("file", fid)
        ck("a file written in another browser and renamed in the stale tab keeps both",
           f["name"] == "renamed-in-the-stale-tab.md" and f["text"] == "rewritten elsewhere", [f["name"], f["text"]])
        ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()
        s.evaluate("hideDocEdit()")
        S.close()

        # the same when the stale write waited in the journal: written while the phone's server was away, the tab closed
        J = mk(); j = open_app(J)
        cid = new_chat_with(j, "one")
        stop()
        MODEL.mode = "answer"
        j.fill("#input", "sent while the server was down"); j.click("#sendBtn")
        j.wait_for_function("() => current.messages.some(m => m.role === 'assistant' && !m.pending && /down/.test(m.content || ''))", timeout=8000)
        j.wait_for_timeout(800)
        ck("(the message waits in the journal)", j.evaluate("Journal.all().then(l => l.some(e => e.kind === 'chat'))"))
        j.close()
        start()
        elsewhere("chat", cid, lambda d: d.__setitem__("title", "Renamed in Opera"))
        j = open_app(J); settle_down(j)
        c = chat_on_phone(cid)
        ck("replayed from the journal: the rename made meanwhile in another browser stays", c["title"] == "Renamed in Opera", c["title"])
        ck("… and the message written while the server was away is there",
           said(c) == ["one", "Reply to: one", "sent while the server was down", "Reply to: sent while the server was down"], said(c))
        ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()

        cid = new_chat_with(j, "one", "two")
        stop()
        j.once("dialog", lambda dlg: dlg.accept("Renamed while the server was down"))
        j.click("#chatTitle")
        j.wait_for_timeout(800)
        j.close()
        start()
        elsewhere("chat", cid, lambda d: d.__setitem__("messages", d["messages"][:2]))
        j = open_app(J); settle_down(j)
        c = chat_on_phone(cid)
        ck("replayed from the journal: messages deleted meanwhile in another browser stay deleted", said(c) == ["one", "Reply to: one"], said(c))
        ck("… and the rename written while the server was away is taken", c["title"] == "Renamed while the server was down", c["title"])
        ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()
        # what the journal keeps beside a change is the version it was made from - not a second copy of its pictures
        pic = "data:image/jpeg;base64," + "A" * 3000000
        pid = "picchat1"
        st, _ = put("chat", pid, {"id": pid, "title": "Pictures", "createdAt": 1, "updatedAt": 1, "cfg": {},
                                  "messages": [{"id": "pm1", "role": "user", "content": "look",
                                                "attachments": [{"kind": "image", "name": "p.jpg", "mime": "image/jpeg", "data": pic}]},
                                               {"id": "pm2", "role": "assistant", "content": "Nice."}]}, 0)
        j.reload(); j.wait_for_function("typeof Device === 'object' && Device.isReady()"); j.wait_for_timeout(300)
        open_chat(j, pid)
        stop()
        j.once("dialog", lambda dlg: dlg.accept("Pictures, renamed"))
        j.click("#chatTitle")
        j.wait_for_timeout(800)
        size = j.evaluate("() => Journal.all().then(l => l.filter(e => e.id === 'picchat1').map(e => [e.body.length, JSON.stringify(e).length])[0])")
        ck("a chat of pictures waits in the journal once, not twice (its base names the messages it shares)",
           size and size[1] < 1.2 * size[0], size)
        start()
        settle_down(j)
        ck("… and is saved from it when the server is back", (chat_on_phone(pid) or {}).get("title") == "Pictures, renamed")
        J.close(); A.close()


def hold_first_put(page, pattern, methods=("PUT",)):
    """The first save to this address waits, unanswered, until released - while it waits, the tab queues the next
    change of the same thing behind it. With methods=("PUT", "DELETE") the first delete waits too."""
    held = []
    def h(route):
        if route.request.method in methods and not any(x.request.method == route.request.method for x in held):
            held.append(route)
        else:
            route.continue_()
    page.route(pattern, h)
    def release():
        for _ in range(50):
            if held:
                break
            page.wait_for_timeout(100)
        for x in held:
            x.continue_()
            page.wait_for_timeout(400)
        settle_down(page)
        page.unroute(pattern)
    return held, release


def section2(br, mk):
    print("=== 2. A CHANGE QUEUED BEHIND A SAVE THE PHONE ANSWERED 409 IS KEPT ===")
    A = mk(); a = open_app(A)
    # settings: Show thinking is being saved, Enter sends waits behind it, another browser picks a theme meanwhile
    a.evaluate("openSettings()")
    think0, enter0 = a.evaluate("[S.showThinking, S.enterSends]")
    held, release = hold_first_put(a, "**/api/store/settings/main")
    a.evaluate("document.querySelector('#tgThink').click()")         # (its folded section of Settings: the button itself)
    a.evaluate("document.querySelector('#tgEnter').click()")
    a.wait_for_timeout(300)
    ck("(the first save waits, the second is queued behind it)", len(held) == 1 and a.evaluate("!Device.idle()"))
    elsewhere("settings", "main", lambda d: d.__setitem__("theme", "light"))
    release()
    ph = on_phone("settings", "main")
    ck("settings: the change queued behind the answered save is kept on the phone (Enter sends)", ph.get("enterSends") == (not enter0), ph.get("enterSends"))
    ck("… and in the tab, toggle and all", a.evaluate("S.enterSends") == (not enter0) and a.evaluate("document.querySelector('#tgEnter').classList.contains('on')") == (not enter0),
       a.evaluate("[S.enterSends, document.querySelector('#tgEnter').className]"))
    ck("… so is the one that was answered 409 (Show thinking)", ph.get("showThinking") == (not think0) and a.evaluate("S.showThinking") == (not think0), ph.get("showThinking"))
    ck("… and so is the theme the other browser picked", ph.get("theme") == "light" and a.evaluate("S.theme") == "light", ph.get("theme"))
    a.evaluate("closeSettings()")

    # a chat: renamed (being saved), pinned (waiting behind it); another browser sets its temperature meanwhile
    cid = new_chat_with(a, "one")
    held, release = hold_first_put(a, "**/api/store/chat/" + cid)
    a.once("dialog", lambda dlg: dlg.accept("Renamed here"))
    a.click("#chatTitle")
    a.click('#convoList [data-id="%s"]' % cid, button="right")
    a.wait_for_timeout(300)
    ck("(the rename waits unanswered, the pin is queued behind it)", len(held) == 1 and a.evaluate("!Device.idle()"))
    elsewhere("chat", cid, lambda d: d.setdefault("cfg", {}).__setitem__("temperature", 0.4))
    release()
    c = chat_on_phone(cid)
    ck("a chat: the pin queued behind the answered save is kept on the phone", c.get("pinned") is True, c.get("pinned"))
    ck("… and in the tab", a.evaluate("id => convos.find(c => c.id === id).pinned", cid) is True)
    ck("… so is the rename that was answered 409", c["title"] == "Renamed here", c["title"])
    ck("… and the other browser's change", (c.get("cfg") or {}).get("temperature") == 0.4, c.get("cfg"))
    ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()

    # a file: renamed (being saved), written and saved (waiting behind it); another browser saved it meanwhile
    a.evaluate("newDoc('draft.md', 'first words')")
    settle_down(a)
    fid = a.evaluate("docs.find(d => d.name === 'draft.md').id")
    a.evaluate("id => openDocEditor(id)", fid)
    held, release = hold_first_put(a, "**/api/store/file/" + fid)
    a.once("dialog", lambda dlg: dlg.accept("final.md"))
    a.click("#docRenameBtn")
    a.fill("#docEditArea", "second words")
    a.click("#docSaveBtn")
    a.wait_for_timeout(300)
    ck("(the rename waits unanswered, the words are queued behind it)", len(held) == 1 and a.evaluate("!Device.idle()"))
    elsewhere("file", fid, lambda d: d.__setitem__("updatedAt", d.get("updatedAt", 0) + 1))
    release()
    f = on_phone("file", fid)
    ck("a file: the words saved behind the answered rename are kept on the phone", f["text"] == "second words", f["text"])
    ck("… and in the editor", a.evaluate("document.querySelector('#docEditArea').value") == "second words", a.evaluate("document.querySelector('#docEditArea').value"))
    ck("… and so is the rename", f["name"] == "final.md", f["name"])
    ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()
    a.evaluate("hideDocEdit()")

    # a chat deleted here while its save was being answered 409 stays deleted
    cid = new_chat_with(a, "one")
    held, release = hold_first_put(a, "**/api/store/chat/" + cid, ("PUT", "DELETE"))
    a.once("dialog", lambda dlg: dlg.accept("Renamed, then deleted"))
    a.click("#chatTitle")
    a.once("dialog", lambda dlg: dlg.accept())
    a.evaluate("id => document.querySelector('#convoList [data-del=\"' + id + '\"]').click()", cid)
    a.wait_for_timeout(300)
    elsewhere("chat", cid, lambda d: d.setdefault("cfg", {}).__setitem__("temperature", 0.6))
    release()
    ck("a chat deleted here while its save was answered 409 is not brought back into the list",
       not a.evaluate("id => convos.some(c => c.id === id)", cid))
    ck("… nor onto the phone", chat_on_phone(cid) is None, said(chat_on_phone(cid)))

    # a chat deleted here, while the delete is on its way another browser saves it (its reply arriving there)
    cid = new_chat_with(a, "one")
    held, release = hold_first_put(a, "**/api/store/chat/" + cid, ("DELETE",))
    a.once("dialog", lambda dlg: dlg.accept())
    a.evaluate("id => document.querySelector('#convoList [data-del=\"' + id + '\"]').click()", cid)
    a.wait_for_timeout(300)
    elsewhere("chat", cid, lambda d: d["messages"].append({"id": "x1", "role": "user", "content": "from the other browser"}))
    a.wait_for_timeout(1500)                                       # the change is announced, and heard
    release()
    ck("a chat deleted here is not read back in by a save another browser announces before the delete lands",
       not a.evaluate("id => convos.some(c => c.id === id)", cid))
    A.close()


def section3(br, mk):
    print("=== 3. WHAT THE PHONE RELOADS IS TAKEN IN PLACE ===")
    A = mk(); a = open_app(A)
    # another browser opens for the first time and hands its chats over, while a reply arrives here
    cid = new_chat_with(a, "first")
    start_arriving(a, "second")
    st, _ = api("/api/store/import", "POST", {"settings": None, "files": [],
                "chats": [{"id": "handed1", "title": "From the other browser", "createdAt": 1, "updatedAt": 2, "cfg": {}, "messages": []}]})
    try:
        a.wait_for_function("() => convos.some(c => c.id === 'handed1')", timeout=6000)
    except Exception:
        pass
    ck("chats another browser hands over while a reply arrives here show up here", a.evaluate("convos.some(c => c.id === 'handed1')"))
    finish_arriving(a)
    c = chat_on_phone(cid)
    ck("the reply that was arriving is on the phone", said(c) == ["first", "Reply to: first", "second", "Reply to: second"], said(c))
    ck("… and on screen, in the chat still open",
       a.evaluate("current.id") == cid and a.evaluate("current.messages.map(m => m.content)") == said(c), a.evaluate("current.messages.map(m => m.content)"))
    send(a, "third")
    c = chat_on_phone(cid)
    ck("… and the next message does not erase it",
       said(c) == ["first", "Reply to: first", "second", "Reply to: second", "third", "Reply to: third"], said(c))

    # a copy brought back in another browser while a rename here is on its way
    cid = new_chat_with(a, "one")
    a.once("dialog", lambda dlg: dlg.accept("Before the copy"))
    a.click("#chatTitle"); settle_down(a)
    st, j = api("/api/backup/now", "POST")
    name = (j or {}).get("name")
    send(a, "two")
    held, release = hold_first_put(a, "**/api/store/chat/" + cid)
    a.once("dialog", lambda dlg: dlg.accept("Renamed while the copy came back"))
    a.click("#chatTitle")
    a.wait_for_timeout(300)
    st, _ = api("/api/backup/restore/" + str(name), "POST")
    a.wait_for_timeout(1500)                                       # the reload is announced, and read
    release()
    c = chat_on_phone(cid)
    ck("a copy brought back elsewhere while a rename here is on its way: the copy's messages are the chat's",
       said(c) == ["one", "Reply to: one"], said(c))
    ck("… and the rename is kept, on the phone", c["title"] == "Renamed while the copy came back", c["title"])
    ck("… and here", a.evaluate("[current.title, current.messages.length]") == ["Renamed while the copy came back", 2],
       a.evaluate("[current.title, current.messages.map(m => m.content)]"))
    ck("… and no copy made", not copies_of(), named(copies_of())); drop_copies()

    # a rename here reaches the phone, then a copy is brought back elsewhere - and only then is the rename answered
    cid = new_chat_with(a, "one")
    a.once("dialog", lambda dlg: dlg.accept("As the copy has it"))
    a.click("#chatTitle"); settle_down(a)
    st, j = api("/api/backup/now", "POST")
    name = (j or {}).get("name")
    send(a, "two")
    late = []
    def answered_late(route):
        if route.request.method == "PUT" and not late:
            late.append((route, route.fetch()))          # the phone takes it now; this tab hears so later
        else:
            route.continue_()
    a.route("**/api/store/chat/" + cid, answered_late)
    a.once("dialog", lambda dlg: dlg.accept("Renamed just before"))
    a.click("#chatTitle")
    a.wait_for_timeout(500)
    ck("(the rename is on the phone, its answer not yet here)", (chat_on_phone(cid) or {}).get("title") == "Renamed just before" and len(late) == 1)
    st, _ = api("/api/backup/restore/" + str(name), "POST")
    a.wait_for_timeout(1500)
    late[0][0].fulfill(response=late[0][1])
    settle_down(a); a.wait_for_timeout(500)
    a.unroute("**/api/store/chat/" + cid)
    c = chat_on_phone(cid)
    ck("a copy brought back after a rename here reached the phone: the tab shows what the phone holds then",
       a.evaluate("[current.title, current.messages.length]") == [c["title"], len(c["messages"])] and c["title"] == "As the copy has it",
       [a.evaluate("[current.title, current.messages.length]"), c["title"], len(c["messages"])])

    # a message open in its editor stays open, with what was typed, when the phone reloads or another browser changes a setting
    cid = new_chat_with(a, "an old message")
    mid = a.evaluate("current.messages[0].id")
    a.hover('.msg[data-mid="%s"]' % mid)
    a.click('.msg[data-mid="%s"] [data-edit]' % mid)
    a.fill("#threadInner .msg-edit", "typed into the editor")
    elsewhere("settings", "main", lambda d: d.__setitem__("theme", "light" if d.get("theme") != "light" else "dark"))
    a.wait_for_timeout(1500)
    ck("a message being edited stays open, with what was typed, when another browser changes a setting",
       a.evaluate("(document.querySelector('#threadInner .msg-edit') || {}).value") == "typed into the editor")
    api("/api/store/import", "POST", {"settings": None, "files": [], "chats": [{"id": "handed2", "title": "Handed over", "createdAt": 1, "updatedAt": 2, "cfg": {}, "messages": []}]})
    a.wait_for_timeout(1500)
    ck("… and when the phone reloads (another browser hands its chats over)",
       a.evaluate("(document.querySelector('#threadInner .msg-edit') || {}).value") == "typed into the editor"
       and a.evaluate("convos.some(c => c.id === 'handed2')"))
    a.evaluate("(document.querySelector('#threadInner [data-canceledit]') || { click(){} }).click()")

    # every chat deleted in another browser while a reply arrives here: the reply goes to the phone's trash, not nowhere
    cid = new_chat_with(a, "kept anyway")
    start_arriving(a, "a reply worth keeping")
    st, _ = api("/api/store/clear/chat", "POST")
    a.wait_for_timeout(1500)
    finish_arriving(a)
    a.wait_for_timeout(800)
    trash = os.path.join(DATA, "trash")
    kept = []
    for n in sorted(os.listdir(trash)):
        if ("-chat-" + cid) in n:
            with open(os.path.join(trash, n), encoding="utf-8") as f:
                kept.append(said(json.load(f).get("data")))
    ck("every chat deleted in another browser while a reply arrives here: the finished reply waits in the phone's trash",
       any(k[-1:] == ["Reply to: a reply worth keeping"] for k in kept), kept)
    ck("… and the chat leaves this tab's list", not a.evaluate("id => convos.some(c => c.id === id)", cid))
    ck("… and the phone does not hold it", chat_on_phone(cid) is None)
    A.close()


def hide(page):
    page.evaluate("() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); }")


def show(page):
    page.evaluate("() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange')); }")


def section4(br, mk):
    print("=== 4. TABS IN THE BACKGROUND LEAVE ROOM; A SAVE WITH NO ANSWER IS KEPT AND SAID ===")
    # six Cozy tabs left open in one browser, all in the background (cozy opens one each time it runs)
    T = mk()
    tabs = []
    for n in range(6):
        p = T.new_page(); p.goto(base() + "/")
        p.wait_for_function("typeof Device === 'object' && Device.isReady()", timeout=10000)
        hide(p); p.wait_for_timeout(200)
        tabs.append(p)
    seventh = T.new_page()
    try:
        seventh.goto(base() + "/", timeout=10000)
        seventh.wait_for_function("typeof Device === 'object' && Device.isReady() && document.querySelector('#chatTitle')", timeout=10000)
        opened = True
    except Exception:
        opened = False
    ck("with six Cozy tabs open in the background, a seventh opens its chats", opened)
    cid = None
    if opened:
        try:
            cid = new_chat_with(seventh, "from the seventh tab")
        except Exception:
            cid = seventh.evaluate("current && current.id")
    ck("… and what it writes reaches the phone", bool(cid) and said(chat_on_phone(cid)) == ["from the seventh tab", "Reply to: from the seventh tab"],
       said(chat_on_phone(cid)) if cid else "nothing written")
    back = tabs[0]
    looks = []
    back.on("request", lambda r: looks.append(r.url) if "/api/version" in r.url else None)
    show(back)
    try:
        back.wait_for_function("id => convos.some(c => c.id === id)", arg=cid, timeout=6000)
    except Exception:
        pass
    ck("a tab back in view shows what another tab wrote while it was in the background", bool(cid) and back.evaluate("id => convos.some(c => c.id === id)", cid))
    if opened and cid:
        seventh.once("dialog", lambda dlg: dlg.accept("Renamed in the seventh tab"))
        seventh.click("#chatTitle"); settle_down(seventh)
    try:
        back.wait_for_function("id => (convos.find(c => c.id === id) || {}).title === 'Renamed in the seventh tab'", arg=cid, timeout=6000)
    except Exception:
        pass
    ck("… and hears the next change as it happens (its stream is open again)",
       bool(cid) and back.evaluate("id => (convos.find(c => c.id === id) || {}).title", cid) == "Renamed in the seventh tab")
    ck("… having looked for a new version of the app once on coming back, as before", len(looks) == 1, looks)
    T.close()

    # a save the phone took, whose answer never comes back to the tab
    A = mk(); a = open_app(A)
    cid = new_chat_with(a, "one")
    late = []
    def taken_unanswered(route):
        if route.request.method == "PUT" and not late and "Reply to: two" in (route.request.post_data or ""):
            late.append((route, route.fetch()))                  # the phone takes it; its answer never arrives
        else:
            route.continue_()
    a.route("**/api/store/chat/" + cid, taken_unanswered)
    MODEL.mode = "answer"
    a.fill("#input", "two"); a.click("#sendBtn")
    try:
        a.wait_for_function("() => !document.querySelector('#storeBanner').hidden", timeout=20000)
    except Exception:
        pass
    ck("a save with no answer for 15 s: the banner says the phone's server isn't answering",
       a.evaluate("!document.querySelector('#storeBanner').hidden") and "answering" in a.inner_text("#storeBanner"),
       a.evaluate("[document.querySelector('#storeBanner').hidden, document.querySelector('#storeBanner').textContent]"))
    ck("… and the change waits in the journal", a.evaluate("id => Journal.all().then(l => l.some(e => e.id === id))", cid))
    ck("(the phone did take it)", said(chat_on_phone(cid)) == ["one", "Reply to: one", "two", "Reply to: two"], said(chat_on_phone(cid)))
    # the last exchange is deleted here meanwhile
    for text in ("Reply to: two", "two"):
        mid = a.evaluate("t => current.messages.find(m => m.content === t).id", text)
        a.hover('.msg[data-mid="%s"]' % mid)
        a.click('.msg[data-mid="%s"] [data-delmsg]' % mid)
        a.wait_for_timeout(200)
    for r, resp in late:                          # (the answer, long after the tab stopped waiting for it)
        try:
            r.fulfill(response=resp)
        except Exception:
            pass
    a.unroute("**/api/store/chat/" + cid)
    try:
        a.wait_for_function("() => document.querySelector('#storeBanner').hidden && Device.idle()", timeout=15000)
    except Exception:
        pass
    a.wait_for_timeout(500)
    c = chat_on_phone(cid)
    ck("once the phone answers again, what was deleted after that save stays deleted", said(c) == ["one", "Reply to: one"], said(c))
    ck("… with no copy made", not copies_of(), named(copies_of())); drop_copies()
    ck("… the banner gone, and the journal empty", a.evaluate("document.querySelector('#storeBanner').hidden")
       and a.evaluate("id => Journal.all().then(l => !l.some(e => e.id === id))", cid))
    A.close()


def section5(br, mk):
    print("=== 5. A CHAT THE PHONE'S LIST DID NOT HAVE YET IS READ, NOT REMOVED ===")
    A = mk(); a = open_app(A)
    held = []
    def read_now_deliver_later(route):
        if not held:
            held.append((route, route.fetch()))             # the list of what the phone holds, read at this moment
        else:
            route.continue_()
    a.route("**/api/store/manifest", read_now_deliver_later)
    hide(a); show(a)                                         # the tab comes back into view: it reads what changed meanwhile
    a.wait_for_timeout(500)
    ck("(the phone's list was read before the new chat existed)", len(held) == 1)
    a.evaluate("document.querySelector('#newChatBtn').click()")
    start_arriving(a, "brand new chat")
    cid = a.evaluate("current.id")
    settle_down(a)
    ck("(the new chat's first save has landed on the phone)", chat_on_phone(cid) is not None)
    route, resp = held.pop()
    route.fulfill(response=resp)                             # the list arrives now - without the new chat in it
    a.wait_for_timeout(1500)
    ck("a chat whose first save landed just after the phone's list was read stays in the tab",
       a.evaluate("id => convos.some(c => c.id === id)", cid))
    ck("… and its reply keeps arriving", a.evaluate("!!(streaming && streaming.asstId)"))
    a.unroute("**/api/store/manifest")
    try:
        finish_arriving(a)
    except Exception:
        MODEL.release(); MODEL.mode = "answer"
    c = chat_on_phone(cid)
    ck("… and the phone holds the whole exchange", said(c) == ["brand new chat", "Reply to: brand new chat"], said(c))
    # the same when the phone reloads everything (another browser hands its chats over) a moment before a first save lands
    held = []
    def all_now_later(route):
        if not held:
            held.append((route, route.fetch()))
        else:
            route.continue_()
    a.route("**/api/store/all", all_now_later)
    api("/api/store/import", "POST", {"settings": None, "files": [], "chats": [{"id": "handed3", "title": "Handed over", "createdAt": 1, "updatedAt": 2, "cfg": {}, "messages": []}]})
    a.wait_for_timeout(800)
    ck("(everything was read before the new file existed)", len(held) == 1)
    a.evaluate("openDocs()")
    a.once("dialog", lambda dlg: dlg.accept("brand-new.md"))
    a.click("#docNewBtn")
    a.wait_for_selector("#docEditModal.show")
    fid = a.evaluate("openDocId")
    settle_down(a)
    ck("(the new file's first save has landed on the phone)", on_phone("file", fid) is not None)
    route, resp = held.pop()
    route.fulfill(response=resp)
    a.wait_for_timeout(1500)
    ck("a file whose first save landed just after a reload read everything stays, open in its editor",
       a.evaluate("id => docs.some(d => d.id === id)", fid) and a.evaluate("openDocId") == fid)
    a.unroute("**/api/store/all")
    a.evaluate("hideDocEdit()")

    # a chat deleted on the phone while this tab heard nothing still goes when its list is read
    gone = new_chat_with(a, "deleted elsewhere")
    a.route("**/api/store/events*", lambda r: r.abort())
    hide(a)
    api("/api/store/chat/" + gone, "DELETE")
    show(a)
    try:
        a.wait_for_function("id => !convos.some(c => c.id === id)", arg=gone, timeout=6000)
    except Exception:
        pass
    ck("a chat deleted on the phone meanwhile still leaves the list when the tab is back in view",
       not a.evaluate("id => convos.some(c => c.id === id)", gone))
    a.unroute("**/api/store/events*")
    A.close()


def temps(sub):
    d = os.path.join(DATA, sub)
    return sorted(n for n in os.listdir(d) if n.endswith(".tmp")) if os.path.isdir(d) else []


def section6(br, mk):
    print("=== 6. THE PHONE OUT OF ROOM: SAID, AND NOTHING HALF-WRITTEN LEFT BEHIND ===")
    big = base64.b64encode(os.urandom(300000)).decode()       # a picture-sized record that does not compress
    st, _ = put("file", "bigfile", {"id": "bigfile", "name": "photo.txt", "text": big, "updatedAt": 1}, 0)
    A = mk(); a = open_app(A)
    cid = new_chat_with(a, "kept before the phone filled up")
    before = sorted(api("/api/store/manifest")[1]["chats"])
    stop()
    for n in os.listdir(os.path.join(DATA, "backups")) if os.path.isdir(os.path.join(DATA, "backups")) else []:
        os.remove(os.path.join(DATA, "backups", n))             # no copy yet today: the start makes one
    limit = 64 * 1024
    start(preexec=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit)))     # no file past 64 KB: the phone is full
    time.sleep(2)                                                  # its daily copy is tried at once, and cannot be written
    ck("a daily copy the phone has no room for leaves no half-written file in backups/", temps("backups") == [], temps("backups"))
    # a save that does not fit
    a.evaluate("id => { current = convos.find(c => c.id === id); renderThread(); }", cid)
    a.fill("#input", "x" * 100000)
    MODEL.mode = "answer"
    a.click("#sendBtn")
    try:
        a.wait_for_function("() => /storage is full/.test(document.querySelector('#storeBanner').textContent) && !document.querySelector('#storeBanner').hidden", timeout=10000)
    except Exception:
        pass
    ck("a save the phone has no room for: the banner says the phone's storage is full",
       "storage is full" in a.inner_text("#storeBanner"), a.inner_text("#storeBanner"))
    a.wait_for_timeout(5500)                                     # it keeps trying, every few seconds
    ck("… and its tries leave no half-written files in chats/", temps("chats") == [], temps("chats"))
    a.evaluate("openSettings()")
    a.evaluate("document.querySelector('#copyNowBtn').click()")
    a.wait_for_timeout(1500)
    ck("Make a copy now, with no room for it, says the phone's storage is full", "storage is full" in a.inner_text("#toast"), a.inner_text("#toast"))
    ck("… and leaves no half-written copy", temps("backups") == [], temps("backups"))
    # a backup file to restore, with no room for all of it: refused whole
    bk = os.path.join(DATA, "..", "cozy-v5291-full.json")
    with open(bk, "w") as f:
        json.dump({"app": "cozy-chat", "settings": SETTINGS, "docs": [],
                   "conversations": [{"id": "small1", "title": "small", "createdAt": 1, "updatedAt": 1, "cfg": {}, "messages": []},
                                     {"id": "huge1", "title": "huge", "createdAt": 1, "updatedAt": 1, "cfg": {},
                                      "messages": [{"id": "h1", "role": "user", "content": big}]}]}, f)
    a.once("dialog", lambda dlg: dlg.accept())
    a.set_input_files("#filePicker", bk)
    a.wait_for_timeout(2500)
    ck("a backup restored with no room for all of it: the phone keeps every chat it had, unchanged",
       sorted(api("/api/store/manifest")[1]["chats"]) == before and said(chat_on_phone(cid))[:1] == ["kept before the phone filled up"],
       sorted(api("/api/store/manifest")[1]["chats"]))
    ck("… and it says the phone's storage is full", "storage is full" in a.inner_text("#toast") and "nothing was changed" in a.inner_text("#toast"), a.inner_text("#toast"))
    ck("… and leaves nothing half-written", temps("chats") == [] and temps("trash") == [] and temps("") == [], [temps("chats"), temps("trash"), temps("")])
    os.remove(bk)
    # what the store takes, as Settings shows it: every folder it writes
    for sub in ("backups", "imported"):
        os.makedirs(os.path.join(DATA, sub), exist_ok=True)
        with open(os.path.join(DATA, sub, "cozy-1999-01-01.json.gz" if sub == "backups" else "settings-1.json"), "wb") as f:
            f.write(b"x" * 50000)
    total = 0
    for sub in ("chats", "files", "sent", "trash", "backups", "imported"):
        d = os.path.join(DATA, sub)
        for n in (os.listdir(d) if os.path.isdir(d) else []):
            total += os.path.getsize(os.path.join(d, n))
    total += os.path.getsize(os.path.join(DATA, "settings.json"))
    u = api("/api/store/usage")[1]
    ck("the storage figure counts the daily copies (backups/) and what was handed over (imported/)", u["bytes"] == total, [u["bytes"], total])
    # half-written files from writes that died (a phone switched off mid-write) are swept away when the server starts
    for sub in ("backups", "trash", "imported"):
        with open(os.path.join(DATA, sub, ".x.json." + sub[:4] + ".tmp"), "wb") as f:
            f.write(b"half")
    stop(); start()                                              # room again
    planted = [n for sub in ("backups", "trash", "imported") for n in temps(sub) if n.startswith(".x.json.")]
    ck("half-written files in backups/, trash/ and imported/ are swept away when the server starts",
       planted == [], planted)                                   # (today's copy, being written now, has its own)
    try:
        a.wait_for_function("() => document.querySelector('#storeBanner').hidden && Device.idle()", timeout=12000)
    except Exception:
        pass
    c = chat_on_phone(cid)
    ck("with room again, the save that waited is on the phone", c and any(m.get("content") == "x" * 100000 for m in c["messages"]), said(c)[:1])
    a.evaluate("closeSettings()")
    A.close()
    api("/api/store/file/bigfile", "DELETE")


def answering(port):
    try:
        urllib.request.urlopen("http://127.0.0.1:%d/api/store/hello" % port, timeout=0.5).read()
        return True
    except Exception:
        return False


def section7(br, mk):
    print("=== 7. ONE SERVER PER DATA FOLDER ===")
    env = dict(os.environ, COZY_DATA_DIR=DATA, COZY_HERMES_HOME=HERMES_DIR, COZY_HERMES_SYNC_SECONDS="3600")
    p2 = free_port()
    second = subprocess.Popen([sys.executable, os.path.join(ROOT, "serve.py"), str(p2), "127.0.0.1"], env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        out, _ = second.communicate(timeout=8); rc = second.returncode
    except subprocess.TimeoutExpired:
        os.killpg(second.pid, signal.SIGKILL); out, _ = second.communicate(); rc = None
    out = out.decode("utf-8", "replace")
    ck("a second server started on the same data folder (another port) stops at once", rc not in (None, 0), rc)
    ck("… saying which port already serves that folder", ("port %d" % PORT) in out and "already running" in out, out.strip())
    ck("… and the first one keeps serving it", api("/api/store/hello")[0] == 200)
    # the first is killed outright (as Android does): the folder is free for the next
    stop()
    third = subprocess.Popen([sys.executable, os.path.join(ROOT, "serve.py"), str(p2), "127.0.0.1"], env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
    up = False
    for _ in range(60):
        if answering(p2):
            up = True; break
        time.sleep(0.1)
    ck("once the first server is gone - even killed outright - the next one serves the folder", up)
    os.killpg(third.pid, signal.SIGKILL); third.wait()
    start()
    # an update rewrites serve.py and the server relights itself (execv): it takes the folder again, and serves on
    app = tempfile.mkdtemp(prefix="cozy-v5291-app-"); data = tempfile.mkdtemp(prefix="cozy-v5291-data-")
    for f in ("serve.py", "index.html"):
        shutil.copy(os.path.join(ROOT, f), app)
    p3 = free_port()
    relit = subprocess.Popen([sys.executable, os.path.join(app, "serve.py"), str(p3), "127.0.0.1"],
                             env=dict(env, COZY_DATA_DIR=data), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        for _ in range(60):
            if answering(p3):
                break
            time.sleep(0.1)
        code = lambda: json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/version" % p3, timeout=2).read()).get("code")
        c0 = code()
        with open(os.path.join(app, "serve.py"), "a") as f:
            f.write("\n# an update\n")
        c1 = None
        for _ in range(80):
            time.sleep(0.1)
            try:
                c1 = code()
            except Exception:
                c1 = None
            if c1 and c1 != c0:
                break
        ck("a server that relights itself after an update holds its folder again and serves on", bool(c1) and c1 != c0 and relit.poll() is None, [c0, c1, relit.poll()])
    finally:
        os.killpg(relit.pid, signal.SIGKILL); relit.wait()
        shutil.rmtree(app, ignore_errors=True); shutil.rmtree(data, ignore_errors=True)
    # bash serve.sh with no port: what it starts (a stand-in python3 says)
    shim = tempfile.mkdtemp(prefix="cozy-v5291-shim-")
    with open(os.path.join(shim, "python3"), "w") as f:
        f.write("#!/bin/sh\necho \"started: $*\"\n")
    os.chmod(os.path.join(shim, "python3"), 0o755)
    r = subprocess.run(["bash", os.path.join(ROOT, "serve.sh")], env=dict(os.environ, PATH=shim + ":" + os.environ["PATH"]),
                       capture_output=True, text=True, timeout=20)
    ck("bash serve.sh with no port serves where cozy does (8787), and says so",
       "started: serve.py 8787 127.0.0.1" in r.stdout and "localhost:8787" in r.stdout, r.stdout.strip().splitlines()[-1:] + r.stdout.strip().splitlines()[2:3])
    shutil.rmtree(shim, ignore_errors=True)


def peak_mb(pid):
    with open("/proc/%d/status" % pid) as f:
        for line in f:
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) / 1024.0
    return None


def section8(br, mk):
    print("=== 8. THE DAILY COPY IS WRITTEN AS IT IS READ ===")
    data = tempfile.mkdtemp(prefix="cozy-v5291-copy-")
    os.makedirs(os.path.join(data, "chats")); os.makedirs(os.path.join(data, "files"))
    store = 0
    for i in range(20):                                         # a store of pictures, about 60 MB
        msgs = []
        for j in range(2):
            pic = "data:image/jpeg;base64," + base64.b64encode(os.urandom(1100000)).decode()
            msgs += [{"id": "u%d" % j, "role": "user", "content": "look", "attachments": [{"kind": "image", "name": "p.jpg", "mime": "image/jpeg", "data": pic}]},
                     {"id": "a%d" % j, "role": "assistant", "content": "Nice picture \u2014 caf\u00e9 \"quoted\"."}]
        raw = b'{"rev":1,"data":' + json.dumps({"id": "pc%02d" % i, "title": "Pictures %d" % i, "createdAt": 1, "updatedAt": 2, "cfg": {}, "messages": msgs},
                                               ensure_ascii=False, separators=(",", ":")).encode() + (b',"by":"t1"}' if i % 2 else b"}")
        with open(os.path.join(data, "chats", "pc%02d.json" % i), "wb") as f:
            f.write(raw)
        store += len(raw)
    with open(os.path.join(data, "files", "doc1.json"), "wb") as f:
        f.write(b'{"rev":3,"data":{"id":"doc1","name":"notes.md","text":"some notes","updatedAt":5},"by":"t9"}')
    with open(os.path.join(data, "settings.json"), "wb") as f:
        f.write(b'{"rev":2,"data":{"theme":"dark","providers":[]}}')
    port = free_port()
    env = dict(os.environ, COZY_DATA_DIR=data, COZY_HERMES_HOME=HERMES_DIR, COZY_HERMES_SYNC_SECONDS="3600")
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "serve.py"), str(port), "127.0.0.1"], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        copies = lambda: sorted(n for n in os.listdir(os.path.join(data, "backups")) if n.endswith(".json.gz")) if os.path.isdir(os.path.join(data, "backups")) else []
        for _ in range(300):
            if copies() and answering(port):
                break
            time.sleep(0.1)
        time.sleep(0.5)
        store_mb = store / 1048576.0
        hwm = peak_mb(srv.pid)
        ck("the daily copy made at start takes less memory than the store it copies (%.0f MB)" % store_mb,
           hwm is not None and hwm < store_mb, "peak %.1f MB" % (hwm or -1))
        r = urllib.request.Request("http://127.0.0.1:%d/api/backup/now" % port, method="POST", data=b"", headers={"X-Cozy-Client": "test"})
        st = urllib.request.urlopen(r, timeout=60).status
        hwm = peak_mb(srv.pid)
        ck("… and so does Make a copy now", st == 200 and hwm < store_mb, "peak %.1f MB" % hwm)
        with open(os.path.join(data, "backups", copies()[-1]), "rb") as f:
            got = json.loads(gzip.decompress(f.read()))
        body = urllib.request.urlopen("http://127.0.0.1:%d/api/store/all" % port, timeout=60).read()
        hwm = peak_mb(srv.pid)
        everything = json.loads(body)
        ck("a browser opening the app reads everything with less memory than the store it reads",
           hwm < store_mb and len(everything["chats"]) == 20 and len(everything["files"]) == 1 and everything["settings"]["rev"] == 2,
           "peak %.1f MB, %d chats" % (hwm, len(everything["chats"])))
        body = everything = None
        want = {}
        for n in os.listdir(os.path.join(data, "chats")):
            with open(os.path.join(data, "chats", n), "rb") as f:
                d = json.load(f)["data"]; want[d["id"]] = d
        ck("the copy holds every chat exactly as kept, and the files and settings, in a Back up file's shape",
           list(got.keys()) == ["app", "kind", "version", "exportedAt", "settings", "conversations", "docs"]
           and got["app"] == "cozy-chat" and got["kind"] == "backup"
           and {c["id"]: c for c in got["conversations"]} == want
           and got["docs"] == [{"id": "doc1", "name": "notes.md", "text": "some notes", "updatedAt": 5}]
           and got["settings"] == {"theme": "dark", "providers": []},
           [list(got.keys()), len(got["conversations"]), got["docs"], got["settings"]])
        # a record whose file was cut short (a disk error) is left out, not the whole copy
        with open(os.path.join(data, "chats", "pc00.json"), "r+b") as f:
            f.truncate(5000)
        r = urllib.request.Request("http://127.0.0.1:%d/api/backup/now" % port, method="POST", data=b"", headers={"X-Cozy-Client": "test"})
        try:
            st = urllib.request.urlopen(r, timeout=60).status
        except urllib.error.HTTPError as e:
            st = e.code
        with open(os.path.join(data, "backups", copies()[-1]), "rb") as f:
            got = json.loads(gzip.decompress(f.read()))
        ck("a chat whose file was cut short is left out of the copy, and every other one is in it",
           st == 200 and sorted(c["id"] for c in got["conversations"]) == sorted(i for i in want if i != "pc00"), [st, len(got["conversations"])])
    finally:
        os.killpg(srv.pid, signal.SIGKILL); srv.wait()
        shutil.rmtree(data, ignore_errors=True)


def section9(br, mk):
    print("=== 9. SMALLER THINGS: A RESTORE WITH A RECORD THE PHONE CANNOT KEEP IS REFUSED WHOLE ===")
    def snapshot():
        man = api("/api/store/manifest")[1]
        return sorted(man["chats"].items()), sorted(man["files"].items())
    put("chat", "keep9", {"id": "keep9", "title": "kept", "createdAt": 1, "updatedAt": 1, "cfg": {}, "messages": []}, 0)
    before = snapshot()
    for name, convs, why in (
            ("a conversation with no id", [{"id": "n1", "title": "fine", "messages": []}, {"title": "no id", "messages": []}], "conversation 2 has no usable id"),
            ("one with an id the phone could not keep", [{"id": "a/../b", "title": "x", "messages": []}], "conversation 1 has no usable id"),
            ("two with one id", [{"id": "d1", "messages": []}, {"id": "d1", "messages": []}], "two conversations share the id d1")):
        st, j = api("/api/store/replace", "POST", {"settings": None, "conversations": convs, "docs": []})
        ck("a restore carrying %s is refused, saying so" % name, st == 400 and why in str((j or {}).get("error")), [st, j])
        ck("… and nothing on the phone is changed", snapshot() == before, snapshot())
    st, j = api("/api/store/replace", "POST", {"settings": None, "conversations": [{"title": "no id", "messages": []}], "docs": [{"id": "f1", "name": "a"}, {"name": "no id"}]})
    ck("a restore with both kinds wrong names the first it finds", st == 400 and "conversation 1 has no usable id" in str((j or {}).get("error")), [st, j])
    st, j = api("/api/store/replace", "POST", {"settings": None, "conversations": [{"id": "ok9", "messages": []}], "docs": [{"name": "no id"}]})
    ck("… a file with no id refuses the restore too", st == 400 and "file 1 has no usable id" in str((j or {}).get("error")) and snapshot() == before, [st, j])

    print("=== 9. SMALLER THINGS: THE TRASH IS PRUNED EVERY HOUR, NOT ONLY AT START ===")
    data = tempfile.mkdtemp(prefix="cozy-v5291-trash-")
    port = free_port()
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "serve.py"), str(port), "127.0.0.1"],
                           env=dict(os.environ, COZY_DATA_DIR=data, COZY_HERMES_HOME=HERMES_DIR, COZY_HERMES_SYNC_SECONDS="3600", COZY_HOURLY_SECONDS="1"),
                           stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        for _ in range(60):
            if answering(port):
                break
            time.sleep(0.1)
        day = 86400 * 1000
        old = "%d-chat-gone31.json" % (int(time.time() * 1000) - 31 * day)
        recent = "%d-chat-gone29.json" % (int(time.time() * 1000) - 29 * day)
        for n in (old, recent):                              # thrown away while the server was already running
            with open(os.path.join(data, "trash", n), "w") as f:
                f.write('{"rev":1,"data":{"id":"x"}}')
        time.sleep(3)                                         # an "hour" (COZY_HOURLY_SECONDS=1) later
        left = sorted(os.listdir(os.path.join(data, "trash")))
        ck("trash older than 30 days goes while the server keeps running, not only when it starts", old not in left, left)
        ck("… and newer trash stays", recent in left, left)
    finally:
        os.killpg(srv.pid, signal.SIGKILL); srv.wait()
        shutil.rmtree(data, ignore_errors=True)


SECTIONS = {1: section1, 2: section2, 3: section3, 4: section4, 5: section5, 6: section6, 7: section7, 8: section8, 9: section9}


def main():
    global PORT
    PORT = free_port()
    start()
    st, _ = put("settings", "main", SETTINGS, 0)
    assert st == 200
    only = [int(x) for x in sys.argv[1:]] or sorted(SECTIONS)     # python3 tests/v5291data_e2e.py 2 3 - just those
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        mk = lambda: br.new_context(service_workers="block", viewport={"width": 1280, "height": 900})
        for n in only:
            SECTIONS[n](br, mk)
        br.close()
    stop()
    shutil.rmtree(DATA, ignore_errors=True); shutil.rmtree(HERMES_DIR, ignore_errors=True)
    print("\n" + ("FAILED %d" % failed if failed else "ALL PASS") + "  (%d checks)" % (passed + failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    try:
        main()
    finally:
        stop()
