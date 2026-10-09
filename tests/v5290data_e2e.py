# TEST FILE - run with: python3 tests/v5290data_e2e.py
# The data fixes after v5.28.9, proven in real Chromium against the real
# serve.py and a real streaming model on localhost (a reply that is still
# arriving is the point of most of these). Separate browser contexts stand in
# for separate browsers. The browser-storage half is tests/v5290datatest.js.
#   1. a chat deleted while its reply is arriving stays deleted on the phone
#   2. only this phone's own names reach the store: a page that points its
#      domain at 127.0.0.1 (DNS rebinding) gets 403 for every request, a
#      write from a foreign Origin is refused, and the dot-file guard reads
#      the decoded path; the app keeps working at 127.0.0.1 and localhost
#   5. a reply still arriving is on the phone, not only in its tab: kept the
#      moment the tab is hidden (though it drew no frame), it survives the tab
#      going away; a browser opening meanwhile leaves it arriving, one opening
#      after its heartbeat went stale settles it; another browser renaming the
#      chat meanwhile makes no copy and ends up showing the finished reply
#   6. an instruction written on its own screen (the full-screen editor) is
#      kept by Save even when a setting changed in another browser meanwhile
#      and the list it was opened from was drawn again
#   7. the service worker keeps one copy of the app: a look for an update
#      (index.html?v=<time>) is not stored, the bloated cache an older worker
#      left is dropped, and the app still opens with the server away
#   8. a backup file the phone could not take whole (a record with no usable
#      id) changes nothing on the phone and says why, before anything is asked
# Needs: pip install playwright && playwright install chromium.
import http.client, json, os, shutil, signal, socket, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = tempfile.mkdtemp(prefix="cozy-v5290-")
HERMES_DIR = tempfile.mkdtemp(prefix="cozy-v5290-hermes-")
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


def start():
    global SRV
    env = dict(os.environ, COZY_DATA_DIR=DATA, COZY_HERMES_HOME=HERMES_DIR, COZY_HERMES_SYNC_SECONDS="3600")
    SRV = subprocess.Popen([sys.executable, os.path.join(ROOT, "serve.py"), str(PORT), "127.0.0.1"], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
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


def chat_on_phone(cid):
    st, j = api("/api/store/chat/" + cid)
    return j["data"] if st == 200 else None


def raw(method, path, headers, body=None, skip_host=False):
    """One request with exactly these headers (a browser's Host and Origin included)."""
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    c.putrequest(method, path, skip_host=skip_host or "Host" in headers, skip_accept_encoding=True)
    for k, v in headers.items():
        c.putheader(k, v)
    data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else b"")
    if method in ("PUT", "POST", "DELETE"):
        c.putheader("Content-Length", str(len(data)))
    c.endheaders(data if data else None)
    r = c.getresponse(); out = r.read(); c.close()
    return r.status, out


def put(kind, rid, data, base_rev):
    return api("/api/store/%s/%s" % (kind, rid), "PUT", data, {"content-type": "application/json", "X-Cozy-Base": str(base_rev)})


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
            "squashSystem": True, "autoTitle": True, "theme": "dark", "seeded513": True,
            "search": {"on": False, "provider": "native", "key": "", "count": 5, "relay": "", "always": False}}


def open_app(ctx, url=None, block_events=False):
    page = ctx.new_page()
    if block_events:
        page.route("**/api/store/events*", lambda r: r.abort())
    page.goto(url or (base() + "/"))
    page.wait_for_function("typeof Device === 'object' && Device.isReady() && document.querySelector('#chatTitle')")
    page.wait_for_timeout(300)
    return page


def send(page, text, timeout=8000):
    page.fill("#input", text)
    page.click("#sendBtn")
    page.wait_for_function("t => current && current.messages.some(m => m.role === 'assistant' && !m.pending && (m.content||'').indexOf(t) >= 0)",
                           arg="Reply to: " + text, timeout=timeout)
    page.wait_for_timeout(300)


def start_arriving(page, text):
    """Send a message whose reply starts and then keeps arriving."""
    MODEL.mode = "arrive"
    page.fill("#input", text)
    page.click("#sendBtn")
    page.wait_for_function("() => streaming && streaming.asstId && current.messages.slice(-1)[0].role === 'assistant'", timeout=8000)
    page.wait_for_timeout(400)


def main():
    global PORT
    PORT = free_port()
    start()
    st, _ = put("settings", "main", SETTINGS, 0)
    assert st == 200
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        mk = lambda: br.new_context(service_workers="block")

        print("=== 1. A CHAT DELETED WHILE ITS REPLY IS ARRIVING STAYS DELETED ===")
        A = mk(); a = open_app(A)
        a.on("dialog", lambda dlg: dlg.accept())
        for how in ("the sidebar's Delete", "the archive's Delete", "Delete every conversation"):
            MODEL.mode = "answer"
            a.evaluate("newConvo()")
            send(a, "first")
            cid = a.evaluate("current.id")
            if how == "the archive's Delete":
                a.evaluate("() => { current.archived = true; DB.put(JSON.parse(JSON.stringify(current))); renderSidebar(); }")
                a.wait_for_timeout(300)
            start_arriving(a, "second")
            if how == "the sidebar's Delete":
                a.evaluate("id => document.querySelector('#convoList [data-del=\"' + id + '\"]').click()", cid)
            elif how == "the archive's Delete":
                a.evaluate("openArchive()")
                a.evaluate("id => document.querySelector('#archList [data-archdel=\"' + id + '\"]').click()", cid)
            else:
                a.evaluate("document.querySelector('#wipeBtn').click()")
            a.wait_for_timeout(1500)
            MODEL.release()
            ck(how + ": the phone does not hold it", chat_on_phone(cid) is None, [m["content"] for m in (chat_on_phone(cid) or {}).get("messages", [])])
            ck(how + ": it waits in the phone's trash", any(("-chat-" + cid) in n for n in os.listdir(os.path.join(DATA, "trash"))))
            B = mk(); b = open_app(B)
            ck(how + ": a browser opening now does not show it", not b.evaluate("id => convos.some(c => c.id === id)", cid))
            B.close()
            a.evaluate("closeArchive()")
        A.close()

        print("=== 2. ONLY THIS PHONE'S OWN NAMES REACH THE STORE ===")
        evil = "rebind.attacker.example:%d" % PORT
        st, body = raw("GET", "/api/store/all", {"Host": evil})
        ck("a page that pointed its own name at 127.0.0.1 cannot read the chats and keys (403)", st == 403 and b'"apiKey"' not in body, st)
        st, body = raw("GET", "/", {"Host": evil})
        ck("nor load the app under its name", st == 403, st)
        before = sorted(api("/api/store/manifest")[1]["chats"])
        st, body = raw("POST", "/api/store/clear/chat", {"Host": evil, "Origin": "http://" + evil, "X-Cozy-Client": "x"})
        ck("nor clear the chats, though it can send X-Cozy-Client", st == 403 and sorted(api("/api/store/manifest")[1]["chats"]) == before, st)
        st, body = raw("GET", "/api/store/all", {"Host": "127.0.0.1:1"})
        ck("a Host naming another port is refused", st == 403, st)
        st, body = raw("GET", "/api/store/hello", {}, skip_host=True)
        ck("a request naming no Host is refused", st == 403, st)
        for host in ("127.0.0.1:%d" % PORT, "localhost:%d" % PORT, "LOCALHOST:%d" % PORT, "[::1]:%d" % PORT):
            st, body = raw("GET", "/api/store/hello", {"Host": host})
            ck("the store answers at " + host, st == 200, st)
        mine = {"Host": "127.0.0.1:%d" % PORT, "X-Cozy-Client": "x", "X-Cozy-Base": "0", "Content-Type": "application/json"}
        rec = {"id": "orig1", "title": "t", "createdAt": 1, "updatedAt": 1, "cfg": {}, "messages": []}
        st, body = raw("PUT", "/api/store/chat/orig1", dict(mine, Origin="http://evil.example"), rec)
        ck("a write that comes from another site's page is refused", st == 403 and chat_on_phone("orig1") is None, st)
        st, body = raw("PUT", "/api/store/chat/orig1", dict(mine, Origin="null"), rec)
        ck("so is one from a page with no origin (Origin: null)", st == 403 and chat_on_phone("orig1") is None, st)
        st, body = raw("PUT", "/api/store/chat/orig1", dict(mine, Origin="http://127.0.0.1:%d" % PORT), rec)
        ck("the app's own write (its Origin is this server) goes through", st == 200 and chat_on_phone("orig1") is not None, st)
        st, body = raw("PUT", "/api/store/chat/orig1", dict(mine, **{"Origin": "http://localhost:%d" % PORT, "Host": "localhost:%d" % PORT, "X-Cozy-Base": "1"}), rec)
        ck("and so does the app opened at localhost", st == 200, st)
        st, body = raw("DELETE", "/api/store/chat/orig1", dict(mine, Origin="http://evil.example"))
        ck("a delete from another site's page is refused", st == 403 and chat_on_phone("orig1") is not None, st)
        st, body = raw("GET", "/%2Egitignore", {"Host": "127.0.0.1:%d" % PORT})
        ck("a dot-file stays unserved when its dot is written %2E", st == 404, st)
        st, body = raw("HEAD", "/.gitignore", {"Host": "127.0.0.1:%d" % PORT})
        ck("and when it is asked for with HEAD", st == 404, st)
        st, body = raw("GET", "/manifest.webmanifest", {"Host": "127.0.0.1:%d" % PORT})
        ck("the app's own files are still served", st == 200, st)
        # a server told to listen on every address (COZY_BIND=0.0.0.0) answers to that address and any
        # address written as numbers - the launcher asks it at http://0.0.0.0:PORT - and still to no name
        wport = free_port(); wdata = tempfile.mkdtemp(prefix="cozy-v5290-wide-")
        wide = subprocess.Popen([sys.executable, os.path.join(ROOT, "serve.py"), str(wport), "0.0.0.0"],
                                env=dict(os.environ, COZY_DATA_DIR=wdata, COZY_HERMES_HOME=HERMES_DIR, COZY_HERMES_SYNC_SECONDS="3600"),
                                stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            def wide_get(host):
                for _ in range(50):
                    try:
                        c = http.client.HTTPConnection("127.0.0.1", wport, timeout=5)
                        c.putrequest("GET", "/api/version", skip_host=True); c.putheader("Host", host); c.endheaders()
                        r = c.getresponse(); r.read(); c.close(); return r.status
                    except OSError:
                        time.sleep(0.1)
                return None
            ck("listening on every address: the launcher's own look (Host 0.0.0.0:PORT) is answered", wide_get("0.0.0.0:%d" % wport) == 200)
            ck("so is the phone's own address written as numbers", wide_get("192.168.1.5:%d" % wport) == 200)
            ck("and a name still is not", wide_get("rebind.attacker.example:%d" % wport) == 403)
        finally:
            os.killpg(wide.pid, signal.SIGKILL); wide.wait(); shutil.rmtree(wdata, ignore_errors=True)
        L = mk(); lp = open_app(L, "http://localhost:%d/" % PORT)
        lp.evaluate("newConvo()")
        MODEL.mode = "answer"
        send(lp, "from localhost")
        ck("the app opened at localhost:PORT keeps its chats on the phone", chat_on_phone(lp.evaluate("current.id")) is not None)
        L.close()

        print("=== 5. A REPLY STILL ARRIVING IS ON THE PHONE, NOT ONLY IN ITS TAB ===")
        A = mk(); a = open_app(A)
        a.evaluate("() => { window.requestAnimationFrame = () => 0; }")        # a hidden tab draws no frame
        a.evaluate("newConvo()")
        start_arriving(a, "a long agent task")
        cid = a.evaluate("current.id")
        tail = lambda c: c and c["messages"][-1]
        ck("while the reply arrives, its tab has not drawn its words (no frame)", a.evaluate("current.messages.slice(-1)[0].content") == "")
        a.evaluate("() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); }")
        a.wait_for_timeout(1200)
        c = chat_on_phone(cid)
        ck("the moment its tab is hidden, the reply so far is on the phone, with the words that arrived",
           tail(c) and tail(c)["role"] == "assistant" and tail(c)["content"] == "Reply to:", tail(c))
        ck("marked as still arriving, with a heartbeat", tail(c) and tail(c).get("pending") is True and isinstance(tail(c).get("beat"), (int, float)), tail(c))
        B = mk(); b = open_app(B)
        c = chat_on_phone(cid)
        ck("a browser opening meanwhile leaves it arriving (its heartbeat is fresh)", tail(c) and tail(c).get("pending") is True, tail(c))
        B.close()
        A.close()                                      # the tab is gone: Android closed it
        MODEL.release()
        time.sleep(0.5)
        c = chat_on_phone(cid)
        ck("the tab going away loses nothing that had arrived", tail(c) and tail(c)["content"] == "Reply to:", tail(c))
        r = api("/api/store/chat/" + cid)[1]; d = r["data"]
        if "beat" in d["messages"][-1]:                # five minutes later: nothing has kept its heartbeat going
            d["messages"][-1]["beat"] -= 5 * 60 * 1000
            put("chat", cid, d, r["rev"])
        C = mk(); cpage = open_app(C)
        cpage.wait_for_timeout(500)
        c = chat_on_phone(cid)
        ck("a browser opening after its heartbeat went stale settles it: kept as a version, no longer arriving",
           tail(c) and not tail(c).get("pending") and tail(c)["content"] == "Reply to:" and len(tail(c).get("variants") or []) == 1, tail(c))
        C.close()

        # another browser renames the chat while the reply arrives; the writing tab does not hear it
        A = mk(); a = open_app(A, block_events=True)
        a.evaluate("newConvo()")
        start_arriving(a, "the story")
        cid = a.evaluate("current.id")
        a.evaluate("() => { const real = Date.now.bind(Date); window.__shift = 11000; Date.now = () => real() + window.__shift; }")    # ten seconds on: the reply is kept
        a.wait_for_timeout(2500)
        c = chat_on_phone(cid)
        ck("ten seconds into the reply it is on the phone, still arriving", tail(c) and tail(c).get("pending") is True, tail(c))
        B = mk(); b = open_app(B)
        b.evaluate("id => { current = convos.find(c => c.id === id); renderThread(); }", cid)
        ck("another browser shows the reply as it arrives", b.evaluate("current.messages.slice(-1)[0].pending === true"))
        b.evaluate("current.title = 'Renamed in the other browser'; persist()")
        b.wait_for_timeout(600)
        a.evaluate("() => { window.__shift = 11000 + 61000; }")      # a minute on: the writing tab keeps it again, over the rename it never heard
        a.wait_for_timeout(2500)
        MODEL.release()
        a.wait_for_function("() => !streaming", timeout=8000); a.wait_for_timeout(800)
        st, man = api("/api/store/manifest")
        copies = [i for i in man["chats"] if "this browser's copy" in ((chat_on_phone(i) or {}).get("title") or "")]
        ck("a rename in another browser while the reply arrives makes no copy of the chat", not copies, copies)
        c = chat_on_phone(cid)
        ck("the phone holds the finished reply", tail(c) and tail(c)["content"] == "Reply to: the story" and not tail(c).get("pending"), tail(c))
        try:
            b.wait_for_function("() => !current.messages.slice(-1)[0].pending", timeout=6000)
        except Exception:
            pass
        ck("and the other browser shows it finished, not the half it was shown",
           b.evaluate("current.messages.slice(-1)[0].content") == "Reply to: the story", b.evaluate("current.messages.slice(-1)[0]"))
        A.close(); B.close()

        print("=== 6. SAVE IN THE FULL-SCREEN EDITOR KEEPS WHAT WAS WRITTEN ===")
        def other_browser_changes_a_setting(tag):
            r = api("/api/store/settings/main")[1]; d = r["data"]
            d.setdefault("ui", {}).setdefault("fold", {})["loose"] = not d["ui"]["fold"].get("loose", False)
            st, _ = put("settings", "main", d, r["rev"])
            return st
        A = mk(); a = open_app(A)
        a.evaluate("openSettings(); addInjection();")
        bid = a.evaluate("PS().injections.slice(-1)[0].id")
        a.wait_for_timeout(600)
        a.evaluate("id => document.querySelector('[data-injtext=\"' + id + '\"]').click()", bid)
        a.wait_for_selector("#bigModal.show")
        a.fill("#bigArea", "An instruction written for ten minutes.")
        ck("another browser changes a setting meanwhile", other_browser_changes_a_setting("block") == 200)
        a.wait_for_timeout(1500)
        a.click("#bigSave")
        a.wait_for_timeout(1000)
        ck("Save keeps the block's text in this browser", a.evaluate("id => (PS().injections.find(i => i.id === id) || {}).text", bid) == "An instruction written for ten minutes.",
           a.evaluate("id => (PS().injections.find(i => i.id === id) || {}).text", bid))
        blk = [i for p in api("/api/store/settings/main")[1]["data"]["presets"] for i in p.get("injections", []) if i["id"] == bid]
        ck("and on the phone", bool(blk) and blk[0]["text"] == "An instruction written for ten minutes.", blk and blk[0]["text"])
        ck("and the block's preview shows it", a.evaluate("id => (document.querySelector('[data-injtext=\"' + id + '\"]') || {}).value", bid) == "An instruction written for ten minutes.")
        # the same for a project's own block
        a.evaluate("""() => { closeSettings(); S.projects = S.projects || []; S.projects.push({id: 'pv5290', name: 'P', injections: [], order: [], docIds: [], createdAt: Date.now()});
                              saveSettings(); openProjEditor('pv5290'); document.querySelector('#projAddInjBtn').click(); }""")
        a.wait_for_timeout(600)
        pid = a.evaluate("S.projects.find(p => p.id === 'pv5290').injections.slice(-1)[0].id")
        a.evaluate("id => document.querySelector('[data-pinjtext=\"' + id + '\"]').click()", pid)
        a.wait_for_selector("#bigModal.show")
        a.fill("#bigArea", "The project's own instruction.")
        other_browser_changes_a_setting("project")
        a.wait_for_timeout(1500)
        a.click("#bigSave")
        a.wait_for_timeout(1000)
        pb = [i for p in api("/api/store/settings/main")[1]["data"].get("projects", []) if p["id"] == "pv5290" for i in p.get("injections", []) if i["id"] == pid]
        ck("a project's block is kept the same way, here and on the phone",
           a.evaluate("id => (S.projects.find(p => p.id === 'pv5290').injections.find(i => i.id === id) || {}).text", pid) == "The project's own instruction."
           and bool(pb) and pb[0]["text"] == "The project's own instruction.", pb and pb[0]["text"])
        A.close()

        print("=== 8. A BACKUP FILE IS CHECKED WHOLE BEFORE THE PHONE IS ASKED TO TAKE IT ===")
        R = mk(); rp = open_app(R)
        asked = {"n": 0}
        rp.on("dialog", lambda dlg: (asked.__setitem__("n", asked["n"] + 1), dlg.accept()))
        before = sorted(api("/api/store/manifest")[1]["chats"])
        bk = os.path.join(DATA, "..", "cozy-v5290-backup.json")
        with open(bk, "w") as f:
            json.dump({"app": "cozy-chat", "settings": SETTINGS, "docs": [],
                       "conversations": [{"id": "fine1", "title": "fine", "messages": []}, {"title": "no id at all", "messages": []}]}, f)
        rp.set_input_files("#filePicker", bk)
        rp.wait_for_timeout(1200)
        ck("nothing is asked", asked["n"] == 0, asked["n"])
        ck("the phone keeps every chat it had", sorted(api("/api/store/manifest")[1]["chats"]) == before and before, before)
        ck("and it says why", "Nothing was restored" in rp.inner_text("#toast") and "conversation 2 has no usable id" in rp.inner_text("#toast"), rp.inner_text("#toast"))
        R.close(); os.remove(bk)

        print("=== 7. THE SERVICE WORKER KEEPS ONE COPY OF THE APP ===")
        W = br.new_context(service_workers="allow")
        w = W.new_page()
        w.route(base() + "/__seed", lambda r: r.fulfill(status=200, content_type="text/html", body="""<script>
          caches.open('cozy-chat-v2').then(c => Promise.all([0, 1, 2].map(i => c.put('/index.html?v=' + i, new Response('x'.repeat(400000))))))
            .then(() => { document.title = 'seeded'; });</script>"""))
        w.goto(base() + "/__seed"); w.wait_for_function("document.title === 'seeded'")
        w.goto(base() + "/")
        w.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller || (navigator.serviceWorker.ready.then(() => location.reload()), false)", timeout=15000)
        w.wait_for_function("typeof Device === 'object' && Device.isReady()", timeout=15000)
        w.wait_for_timeout(800)
        names = w.evaluate("caches.keys()")
        ck("the cache an older worker filled is dropped", "cozy-chat-v2" not in names, names)
        for _ in range(3):
            w.evaluate("checkForUpdate()"); w.wait_for_timeout(400)
        looks = w.evaluate("""async () => { let n = 0; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys())
                                              if (r.url.indexOf('?') >= 0) n++; return n; }""")
        ck("three looks for an update store no copy of the app", looks == 0, looks)
        kept = w.evaluate("async () => { let out = []; for (const k of await caches.keys()) out = out.concat((await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname)); return out; }")
        ck("the app itself is still kept for when the server is away", "/" in kept or "/index.html" in kept, kept)
        stop()
        w.reload(); w.wait_for_timeout(1500)
        ck("with the server away the app still opens, from that copy", "Waiting for Cozy on this phone" in w.inner_text("#threadInner"), w.inner_text("#threadInner")[:80])
        start()
        W.close()

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
