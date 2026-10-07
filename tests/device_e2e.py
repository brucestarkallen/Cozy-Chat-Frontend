# TEST FILE - run with: python3 tests/device_e2e.py
# The phone keeps the data (v5.27.0), proven in real Chromium against the real
# serve.py: separate browser contexts stand in for separate browsers (Opera,
# Chrome) - each has its own storage, exactly like two browsers on one phone.
# Needs: pip install playwright && playwright install chromium.
import json, os, shutil, signal, socket, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = tempfile.mkdtemp(prefix="cozy-e2e-")
HERMES_DIR = tempfile.mkdtemp(prefix="cozy-e2e-hermes-")      # stands in for ~/.hermes
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
    for _ in range(50):
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
    r = urllib.request.Request(base() + path, method=method, data=body, headers=headers or {})
    try:
        with urllib.request.urlopen(r, timeout=5) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def chat_on_phone(cid):
    st, j = api("/api/store/chat/" + cid)
    return j["data"] if st == 200 else None


SETTINGS = {"providers": [{"id": "p1", "preset": "custom", "kind": "openai", "name": "Mock", "url": "https://llm.test/v1",
                           "apiKey": "k", "model": "mock-1", "ctx": 100000}],
            "activeProvider": "p1", "presets": [{"id": "d", "name": "D", "system": "BE KIND", "injections": [],
                                                  "order": ["__main__", "__chat__"]}],
            "activePreset": "d", "prompts": [], "projects": [], "temperature": 1, "maxTokens": 4096, "effort": "off",
            "squashSystem": True, "autoTitle": True, "theme": "dark", "seeded513": True,
            "search": {"on": False, "provider": "native", "key": "", "count": 5, "relay": "", "always": False}}

HANG = {"on": False}


def provider(route):
    """The model: answers 'Reply to: <last user words>', with the service's own count."""
    if HANG["on"]:
        return                                    # never answers: a reply still arriving when the tab closes
    body = json.loads(route.request.post_data or "{}")
    last = [m for m in body.get("messages", []) if m.get("role") == "user"][-1]["content"]
    words = "Reply to: " + (last if isinstance(last, str) else "?")
    sse = "".join("data: " + json.dumps({"choices": [{"delta": {"content": w}}]}) + "\n\n" for w in [words[:5], words[5:]])
    sse += "data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 77, "completion_tokens": 5}}) + "\n\n" + "data: [DONE]\n\n"
    route.fulfill(status=200, headers={"content-type": "text/event-stream", "access-control-allow-origin": "*"}, body=sse)


def open_app(ctx):
    page = ctx.new_page()
    page.route("https://llm.test/**", provider)
    page.goto(base() + "/")
    page.wait_for_function("typeof Device === 'object' && Device.isReady() && document.querySelector('#chatTitle')")
    page.wait_for_timeout(300)
    return page


def send(page, text):
    page.fill("#input", text)
    page.click("#sendBtn")
    page.wait_for_function("t => current && current.messages.some(m => m.role === 'assistant' && !m.pending && (m.content||'').indexOf(t) >= 0)",
                           arg="Reply to: " + text, timeout=8000)
    page.wait_for_timeout(400)


def main():
    global PORT
    PORT = free_port()
    start()
    st, _ = api("/api/store/settings/main", "PUT", json.dumps(SETTINGS).encode(),
                {"content-type": "application/json", "X-Cozy-Base": "0", "X-Cozy-Client": "test"})
    assert st == 200
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        mk = lambda: br.new_context(service_workers="block")

        print("=== 1. ONE BROWSER WRITES, THE PHONE KEEPS IT ===")
        A = mk(); a = open_app(A)
        ck("the page knows the phone keeps the data", a.evaluate("DEVICE") is True)
        send(a, "hello phone")
        cid = a.evaluate("current.id")
        c = chat_on_phone(cid)
        ck("the chat is a file on the phone", c is not None and os.path.exists(os.path.join(DATA, "chats", cid + ".json")))
        ck("… holding both sides of the exchange", c and [m["content"] for m in c["messages"]] == ["hello phone", "Reply to: hello phone"],
           c and [m["content"] for m in c["messages"]])
        ck("the browser keeps none of it", a.evaluate("localStorage.getItem('cozychat:settings')") is None
           and a.evaluate("IDB.all().then(l => l.length)") == 0)

        print("=== 2. A SECOND BROWSER SEES THE SAME CHATS, LIVE ===")
        B = mk(); b = open_app(B)
        ck("it opens with the first browser's chat", b.evaluate("convos.length") == 1 and b.evaluate("convos[0].id") == cid)
        b.evaluate("id => { current = convos.find(c => c.id === id); renderThread(); }", cid)
        send(a, "second message")
        b.wait_for_function("() => current && current.messages.length === 4", timeout=6000)
        ck("a reply sent in one browser appears in the other without a reload",
           "Reply to: second message" in b.inner_text("#threadInner"))
        b.evaluate("current.title = 'Renamed in B'; persist()")
        a.wait_for_function("() => convos[0].title === 'Renamed in B'", timeout=6000)
        ck("a rename in the other direction lands live too", a.inner_text("#convoList").find("Renamed in B") >= 0)

        print("=== 3. ANY BROWSER, EVEN A WIPED ONE ===")
        C = mk(); cpage = open_app(C)
        ck("a browser with nothing stored opens every chat", cpage.evaluate("convos.length") == 1 and cpage.evaluate("convos[0].messages.length") == 4)
        ck("… and the settings", cpage.evaluate("S.providers[0].name") == "Mock")
        C.close()

        print("=== 4. WHAT THE MODEL SAW, KEPT ON THE PHONE ===")
        a.evaluate("id => { current = convos.find(c => c.id === id); renderThread(); }", cid)
        a.wait_for_selector(".msg-sent")
        ck("the line under each reply", "What the model saw · 77 tokens" in a.inner_text(".msg.assistant .msg-sent"),
           a.inner_text(".msg.assistant .msg-sent"))
        ck("the request is on the phone", os.path.exists(os.path.join(DATA, "sent", cid + ".json")))
        a.reload(); a.wait_for_function("typeof Device === 'object' && Device.isReady()"); a.wait_for_timeout(300)
        a.evaluate("id => { current = convos.find(c => c.id === id); renderThread(); }", cid)
        a.click(".msg.assistant .msg-sent >> nth=0")
        a.wait_for_selector("#sentNormal .sent-name")
        names = a.eval_on_selector_all("#sentNormal .sent-name", "els => els.map(e => e.textContent)")
        ck("after a reload it opens from the phone, part by part", names == ["Main system prompt", "The conversation"], names)
        a.click("[data-sentview=raw]")
        ck("Raw holds the request as it went out", '"model": "mock-1"' in a.inner_text("#sentRaw"))
        a.click("#closeSent")
        a.screenshot(path="/tmp/cozy-e2e-a.png")

        print("=== 5. A BROWSER THAT FELL BEHIND CANNOT WRITE OVER NEWER WORK ===")
        S2 = mk(); s = S2.new_page(); s.route("https://llm.test/**", provider)
        s.route("**/api/store/events*", lambda r: r.abort())     # this tab hears nothing: stale by construction
        s.goto(base() + "/"); s.wait_for_function("typeof Device === 'object' && Device.isReady()"); s.wait_for_timeout(300)
        s.evaluate("id => { current = convos.find(c => c.id === id); renderThread(); }", cid)
        send(a, "newer in A")                                         # the phone moves on
        s.evaluate("current.title = 'Stale rename'; persist()")       # stale tab changes only the title
        s.wait_for_timeout(1200)
        c = chat_on_phone(cid)
        ck("a stale rename merges: newer messages kept, the new title taken", c["title"] == "Stale rename" and len(c["messages"]) == 6,
           (c["title"], len(c["messages"])))
        ck("the merge brought the stale tab up to date", s.evaluate("current.messages.length") == 6)
        send(a, "newer in A again")                                   # the phone moves on; the stale tab hears nothing
        send(s, "written by the stale tab")                           # it writes from an old revision
        s.wait_for_timeout(1500)
        st, man = api("/api/store/manifest")
        copies = [chat_on_phone(i) for i in man["chats"]]
        orig = chat_on_phone(cid)
        fork = [x for x in copies if x and x["id"] != cid and "this browser's copy" in x.get("title", "")]
        said = lambda c: [m["content"] for m in c["messages"]]
        ck("both sides wrote messages: the phone's chat keeps its own, and only its own",
           "Reply to: newer in A again" in said(orig) and "written by the stale tab" not in said(orig), said(orig))
        ck("… and the stale tab's version is a copy beside it, with its message and the reply to it",
           len(fork) == 1 and said(fork[0])[-2:] == ["written by the stale tab", "Reply to: written by the stale tab"],
           [said(x)[-2:] for x in fork])
        ck("the stale tab is looking at its copy", s.evaluate("current.title").endswith("(this browser's copy)"))
        S2.close()

        print("=== 6. THE SERVER GOES AWAY MID-SESSION ===")
        stop()
        a.evaluate("current.title = 'Renamed while down'; persist()")
        a.wait_for_selector("#storeBanner:not([hidden])", timeout=6000)
        ck("the page says so, and what is waiting", "isn't answering" in a.inner_text("#storeBanner"), a.inner_text("#storeBanner"))
        ck("the change waits in the journal", a.evaluate("Journal.all().then(l => l.length)") >= 1)
        start()
        a.wait_for_selector("#storeBanner", state="hidden", timeout=8000)
        a.wait_for_timeout(500)
        ck("back up: it saved by itself", chat_on_phone(cid)["title"] == "Renamed while down")
        ck("… and the journal is empty", a.evaluate("Journal.all().then(l => l.length)") == 0)
        stop()
        a.evaluate("current.title = 'Renamed then closed'; persist()")
        a.wait_for_selector("#storeBanner:not([hidden])", timeout=6000)
        a.close()
        start()
        a = open_app(A)
        ck("a tab closed while the server was down still delivers its change on the next open",
           chat_on_phone(cid)["title"] == "Renamed then closed")

        print("=== 7. A SWIPE CUT OFF BY A CLOSED TAB LOSES NO VERSION ===")
        a.evaluate("id => { current = convos.find(c => c.id === id); renderThread(); }", cid)
        before = [m for m in chat_on_phone(cid)["messages"] if m["role"] == "assistant"][-1]
        HANG["on"] = True
        a.click("#regenBtn"); a.wait_for_timeout(500)
        ck("the reply is streaming", a.evaluate("current.messages[current.messages.length-1].pending") is True)
        a.unroute_all(behavior="ignoreErrors"); a.close(); HANG["on"] = False
        after = [m for m in chat_on_phone(cid)["messages"] if m["role"] == "assistant"][-1]
        ck("the phone still holds the reply as it was", after["content"] == before["content"] and after["id"] == before["id"])
        a = open_app(A)

        print("=== 8. A BROWSER THAT KEPT CHATS BEFORE THE PHONE DID HANDS THEM OVER ===")
        D = mk(); d = D.new_page()
        legacy_chat = {"id": "legacy1", "title": "From the old browser", "createdAt": 1, "updatedAt": 2, "cfg": {},
                       "messages": [{"id": "lm1", "role": "user", "content": "kept in Chrome"}]}
        legacy_doc = {"id": "legdoc1", "name": "old.md", "text": "old file", "updatedAt": 2, "undo": []}
        d.route(base() + "/__seed", lambda r: r.fulfill(status=200, content_type="text/html", body="""<script>
          localStorage.setItem('cozychat:settings', JSON.stringify(%s));
          const q = indexedDB.open('cozychat', 2);
          q.onupgradeneeded = () => { q.result.createObjectStore('convos', {keyPath:'id'}); q.result.createObjectStore('docs', {keyPath:'id'}); };
          q.onsuccess = () => { const t = q.result.transaction(['convos','docs'], 'readwrite');
            t.objectStore('convos').put(%s); t.objectStore('docs').put(%s);
            t.oncomplete = () => { q.result.close(); document.title = 'seeded'; }; };
        </script>""" % (json.dumps(dict(SETTINGS, providers=[dict(SETTINGS["providers"][0], apiKey="old-browser-key")] + [{"id": "p9", "name": "Old Conn", "kind": "openai", "url": "https://x/v1", "apiKey": "z", "model": "q"}])),
                        json.dumps(legacy_chat), json.dumps(legacy_doc))))
        d.goto(base() + "/__seed"); d.wait_for_function("document.title === 'seeded'")
        d.goto(base() + "/"); d.wait_for_function("typeof Device === 'object' && Device.isReady()"); d.wait_for_timeout(600)
        ck("its chat is on the phone now", chat_on_phone("legacy1") is not None)
        ck("its file too", api("/api/store/file/legdoc1")[0] == 200)
        ck("its extra connection joined the phone's settings", any(p["id"] == "p9" for p in api("/api/store/settings/main")[1]["data"]["providers"]))
        ck("… while the phone's own settings stayed", api("/api/store/settings/main")[1]["data"]["providers"][0]["name"] == "Mock")
        provs = api("/api/store/settings/main")[1]["data"]["providers"]
        ck("a connection that arrived with another key comes in beside the phone's, not instead of it, nor lost",
           [p["apiKey"] for p in provs if p["id"] == "p1"] == ["k"] and any(p["name"] == "Mock (from this browser)" and p["apiKey"] == "old-browser-key" for p in provs),
           [(p["name"], p["apiKey"]) for p in provs])
        ck("and the settings that arrived are kept whole on the phone", any(n.startswith("settings-") for n in os.listdir(os.path.join(DATA, "imported"))))
        ck("the browser keeps none of it any more", d.evaluate("localStorage.getItem('cozychat:settings')") is None
           and d.evaluate("IDB.all().then(l => l.length)") == 0 and d.evaluate("IDB.docAll().then(l => l.length)") == 0)
        ck("it says what it moved", "Moved 1 chat and 1 file" in d.inner_text("#toast"), d.inner_text("#toast"))
        a.wait_for_function("() => convos.some(c => c.id === 'legacy1')", timeout=6000)
        ck("the open browser picked it up live", True)
        D.close()

        print("=== 9. DELETE GOES TO THE PHONE'S TRASH; THE OTHER BROWSER FOLLOWS ===")
        b.reload(); b.wait_for_function("typeof Device === 'object' && Device.isReady()"); b.wait_for_timeout(300)
        b.on("dialog", lambda dlg: dlg.accept())
        b.evaluate("() => { const r = document.querySelector('[data-del=\"legacy1\"]'); r.click(); }")
        b.wait_for_timeout(600)
        ck("deleted from the phone", chat_on_phone("legacy1") is None)
        ck("… into its trash folder", any("-chat-legacy1" in n for n in os.listdir(os.path.join(DATA, "trash"))))
        a.wait_for_function("() => !convos.some(c => c.id === 'legacy1')", timeout=6000)
        ck("the other browser let it go live", True)

        print("=== 10. RESTORE FROM A FILE REPLACES WHAT THE PHONE HOLDS ===")
        bk = os.path.join(DATA, "..", "cozy-backup-test.json")
        with open(bk, "w") as f:
            json.dump({"app": "cozy-chat", "settings": SETTINGS, "conversations": [{"id": "rb1", "title": "From backup", "createdAt": 1,
                       "updatedAt": 5, "cfg": {}, "messages": [{"id": "x", "role": "user", "content": "restored"}]}], "docs": []}, f)
        b.on("dialog", lambda dlg: None)
        before_ids = list(api("/api/store/manifest")[1]["chats"].keys())
        b.set_input_files("#filePicker", bk)
        b.wait_for_function("() => convos.length === 1 && convos[0].id === 'rb1'", timeout=6000)
        st, man = api("/api/store/manifest")
        ck("the phone holds exactly the backup", list(man["chats"].keys()) == ["rb1"], list(man["chats"].keys()))
        a.wait_for_function("() => convos.length === 1 && convos[0].id === 'rb1'", timeout=6000)
        ck("the other browser reloaded it live", True)
        trash = os.listdir(os.path.join(DATA, "trash"))
        ck("every chat it replaced is in the trash", before_ids and all(any(n.endswith("-chat-" + i + ".json") for n in trash) for i in before_ids), before_ids)

        print("=== 11. A PAGE FROM AN OLD SERVER KEEPS DATA IN THE BROWSER AND SAYS SO ===")
        E = mk(); e = E.new_page()
        html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read().replace("</head>", '<meta name="cozy-vault" content="1"></head>', 1)
        e.route(base() + "/", lambda r: r.fulfill(status=200, content_type="text/html", body=html))
        e.goto(base() + "/"); e.wait_for_timeout(800)
        ck("it runs from the browser's storage", e.evaluate("STORE_MODE") == "stale" and e.evaluate("DEVICE") is False)
        e.evaluate("renderDataHint()")
        ck("and the panel says to run cozy once", "Run cozy in Termux once" in e.inner_text("#dataHint"))
        E.close()

        print("=== 12. THE SIDEBAR'S FOLDS ARE THE SAME IN EVERY BROWSER ===")
        a.evaluate("""() => { S.projects.push({id:'mu0000e2e1', name:'E2E project', injections:[], order:['__main__','__chat__'], docIds:[], createdAt:Date.now()});
                              saveSettings(); renderSidebar(); }""")
        b.wait_for_selector("[data-proj=mu0000e2e1]", timeout=6000)
        ck("a project made in one browser appears in the other, folded", b.evaluate("document.querySelector('[data-proj=mu0000e2e1]').classList.contains('folded')"))
        a.evaluate("document.querySelector('[data-fold=\"p:mu0000e2e1\"]').click()")
        b.wait_for_function("() => !document.querySelector('[data-proj=mu0000e2e1]').classList.contains('folded')", timeout=6000)
        ck("opening it in one opens it in the other", True)

        print("=== 13. A COPY OF EVERYTHING, KEPT ON THE PHONE ===")
        a.evaluate("document.querySelector('#copyNowBtn').click()")
        a.wait_for_timeout(800)
        st, lst = api("/api/backup/list")
        ck("a copy is on the phone", len(lst["copies"]) == 1 and os.path.exists(os.path.join(DATA, "backups", lst["copies"][0]["name"])), lst)
        a.evaluate("current = convos.find(c => c.id === 'rb1'); current.title = 'Changed after the copy'; persist()")
        a.wait_for_timeout(500)
        ck("the phone has the change", chat_on_phone("rb1")["title"] == "Changed after the copy")
        a.on("dialog", lambda dlg: dlg.accept())
        a.evaluate("renderCopies()"); a.wait_for_timeout(300)
        a.evaluate("document.querySelector('#copyRestoreBtn').click()")
        a.wait_for_function("() => convos.length && convos.find(c => c.id === 'rb1').title === 'From backup'", timeout=6000)
        ck("bringing the copy back restores it, here and on the phone", chat_on_phone("rb1")["title"] == "From backup")
        ck("what it replaced waits in the trash", any(n.endswith("-chat-rb1.json") for n in os.listdir(os.path.join(DATA, "trash"))))
        b.wait_for_function("() => convos.find(c => c.id === 'rb1') && convos.find(c => c.id === 'rb1').title === 'From backup'", timeout=6000)
        ck("the other browser follows", True)

        print("=== 14. A NEW VERSION ON THE PHONE TAKES OVER AN OPEN TAB ===")
        # set before the route, so a look already in flight cannot reload for real; the arrow keeps
        # Playwright from calling the stub itself (a string that evaluates to a function gets called)
        a.evaluate("() => { window.__reloads = 0; reloadPage = function(){ window.__reloads++; }; }")
        a.route("**/api/version", lambda r: r.fulfill(status=200, content_type="application/json",
                                                       body=json.dumps({"app": "cozy-chat", "version": "9.9.9", "code": "x", "store": 2})))
        a.evaluate("Promise.all([lookForUpdate(true), lookForUpdate(true)])"); a.wait_for_timeout(300)
        ck("two looks at once reload once", a.evaluate("window.__reloads") == 1)
        a.evaluate("sessionStorage.removeItem('cozychat:reloadedFor'); window.__reloads = 0")
        a.evaluate("lookForUpdate(true)"); a.wait_for_timeout(300)
        ck("idle, it reloads into the new version by itself", a.evaluate("window.__reloads") == 1)
        a.unroute("**/api/version")

        print("=== 15. HERMES GOT A NEW KEY: COZY TAKES IT FROM HERMES ON THE PHONE ===")
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        GK = {"key": "first-strong-key-0123456789"}
        class G(BaseHTTPRequestHandler):
            def log_message(self, *x): pass
            def _cors(self):
                self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "*")
                self.send_header("Access-Control-Allow-Methods", "*")
            def do_OPTIONS(self):
                self.send_response(204); self._cors(); self.end_headers()
            def _ok(self):
                if self.headers.get("Authorization") == "Bearer " + GK["key"]: return True
                self.send_response(401); self._cors(); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(b'{"error":{"message":"Invalid gateway API key (API_SERVER_KEY)"}}'); return False
            def do_GET(self):
                if not self._ok(): return
                self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(b'{"data":[{"id":"hermes-agent"}]}')
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if not self._ok(): return
                self.send_response(200); self._cors(); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": "Hermes here"}}]}) + "\n\ndata: [DONE]\n\n").encode())
        gport = free_port()
        gsrv = ThreadingHTTPServer(("127.0.0.1", gport), G); threading.Thread(target=gsrv.serve_forever, daemon=True).start()
        def hermes_env(k):
            GK["key"] = k
            with open(os.path.join(HERMES_DIR, ".env"), "w") as f:
                f.write('API_SERVER_ENABLED=true\nAPI_SERVER_KEY="%s"\nAPI_SERVER_PORT=%d\n' % (k, gport))
        hermes_env("first-strong-key-0123456789")
        a.evaluate("""p => { S.providers.push({id:'phx', preset:'custom', kind:'openai', name:'Hermes Agent', url:'http://127.0.0.1:' + p + '/v1',
                                               apiKey:'pick-any-password', model:'hermes-agent', ctx:200000}); saveSettings(); }""", gport)
        a.wait_for_timeout(500)
        stop(); start()                                           # the server looks when it starts
        key_on_phone = lambda: [x for x in api("/api/store/settings/main")[1]["data"]["providers"] if x["id"] == "phx"][0]["apiKey"]
        # The first look runs beside the server, not before it: /hello answers
        # while that look is still asking Hermes, so the phone is read until it
        # has settled (the tab check below waits the same way).
        t_end = time.time() + 8
        while key_on_phone() != "first-strong-key-0123456789" and time.time() < t_end:
            time.sleep(0.1)
        ck("the phone took the key Hermes accepts, by itself", key_on_phone() == "first-strong-key-0123456789", key_on_phone())
        a.wait_for_function("() => (S.providers.find(x => x.id === 'phx') || {}).apiKey === 'first-strong-key-0123456789'", timeout=8000)
        ck("and the open tab has it without a reload", True)
        hermes_env("second-strong-key-9876543210")                 # Hermes gets a new key while the tab is open
        a.evaluate("newConvo(); cfgSet('providerId', 'phx'); renderThread();")
        a.fill("#input", "hello hermes"); a.click("#sendBtn")
        a.wait_for_function("() => current.messages.some(m => m.role === 'error')", timeout=8000)
        err = a.evaluate("current.messages.filter(m => m.role === 'error').pop().content")
        ck("a refused message says Cozy took the new key", err.startswith("Hermes had a new key, so Cozy took it from Hermes on this phone"), err[:90])
        ck("the phone holds the new key", key_on_phone() == "second-strong-key-9876543210")
        a.click("#regenBtn")
        a.wait_for_function("() => current.messages.some(m => m.role === 'assistant' && m.content === 'Hermes here')", timeout=8000)
        ck("Retry goes through", True)
        hermes_env("third-strong-key-5555555555")
        a.evaluate("openSettings(); editProv('phx');"); a.wait_for_timeout(300)
        a.evaluate("testProv()")
        a.wait_for_function("() => /Works/.test(document.querySelector('#toast').textContent)", timeout=8000)
        ck("the connection's Test takes the new key and passes", a.evaluate("document.querySelector('#pKey').value") == "third-strong-key-5555555555")
        gsrv.shutdown()
        br.close()
    stop()
    shutil.rmtree(DATA, ignore_errors=True)
    print("\n" + ("FAILED %d" % failed if failed else "ALL PASS") + "  (%d checks)" % (passed + failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    try:
        main()
    finally:
        stop()
