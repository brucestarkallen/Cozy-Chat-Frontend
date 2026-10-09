# TEST FILE - run with: python3 tests/v5290ui_e2e.py [checkout]
# The interface in real Chromium on a phone-sized screen (412 x 915, touch),
# for what jsdom cannot show: whether a hostile value in an imported
# instruction set or a restored backup RUNS (jsdom loads no image, so an
# onerror never fires there), where a tap on a phone lands, and whether a
# message's buttons fit the screen.
#   1. an imported set and a restored backup with hostile values: nothing runs
#   2. a finger on a message's hidden actions only shows them
#   3. a long model id never pushes a message's buttons off the screen
# Needs: pip install playwright && playwright install chromium.
import json, os, shutil, socket, sys, tempfile, threading, time, http.server
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = failed = 0


def ck(name, ok, extra=""):
    global passed, failed
    ok = bool(ok)
    print(("  ok   " if ok else "  FAIL ") + name + (("  -> " + str(extra)) if extra != "" else ""))
    passed += ok
    failed += (not ok)


# ---------- a service that streams what PLAN says ----------
PLAN = {"chunks": ["Hello."], "delay": 0.02}
CALLS = []


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(s, *a):
        pass

    def do_POST(s):
        n = int(s.headers.get("Content-Length") or 0)
        s.rfile.read(n)
        CALLS.append(s.path)
        s.send_response(200)
        s.send_header("Content-Type", "text/event-stream")
        s.end_headers()
        try:
            for c in PLAN["chunks"]:
                s.wfile.write(b"data: " + json.dumps({"choices": [{"delta": {"content": c}}]}).encode() + b"\n\n")
                s.wfile.flush()
                time.sleep(PLAN["delay"])
            s.wfile.write(b"data: [DONE]\n\n")
        except (BrokenPipeError, ConnectionResetError):
            pass


class S(http.server.ThreadingHTTPServer):
    daemon_threads = True


sk = socket.socket(); sk.bind(("127.0.0.1", 0)); PORT = sk.getsockname()[1]; sk.close()
SRV = S(("127.0.0.1", PORT), H)
threading.Thread(target=SRV.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % PORT
D = tempfile.mkdtemp(prefix="cozy-ui-")


def settings(**o):
    st = {"providers": [{"id": "p1", "preset": "custom", "kind": "openai", "name": "T", "url": BASE + "/v1", "apiKey": "secret-key", "model": "m", "ctx": 200000}],
          "activeProvider": "p1", "presets": [{"id": "d", "name": "D", "system": "", "injections": [], "order": ["__main__", "__chat__"]}],
          "activePreset": "d", "prompts": [], "maxTokens": 1024, "effort": "off", "showThinking": True, "catchThinkTags": True, "thinkTags": "think",
          "enterSends": False, "autoTitle": False, "theme": "dark", "search": {"on": False, "provider": "native", "key": "", "count": 5, "relay": "", "always": False}}
    st.update(o)
    return st


def runs(tag):
    """markup that, if it ever became markup, runs and says so"""
    return '"><img src="x" onerror="(window.__pwn=window.__pwn||[]).push(\'%s\')">' % tag


def write(name, obj):
    path = os.path.join(D, name)
    with open(path, "w") as f:
        json.dump(obj, f)
    return path


with sync_playwright() as pw:
    br = pw.chromium.launch()

    def page_for(st=None):
        ctx = br.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2.625, is_mobile=True, has_touch=True)
        ctx.add_init_script("if (!localStorage.getItem('cozychat:settings')) localStorage.setItem('cozychat:settings', %s)" % json.dumps(json.dumps(st or settings())))
        pg = ctx.new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        pg.on("dialog", lambda dlg: dlg.accept())
        pg.goto(BASE + "/index.html"); pg.wait_for_selector("#input"); pg.wait_for_timeout(600)
        return ctx, pg

    def ran(pg):
        return pg.evaluate("window.__pwn || []")

    print("=== 1. AN IMPORTED SET AND A RESTORED BACKUP: NOTHING IN THEM RUNS ===")
    ctx, pg = page_for()
    pg.evaluate("newConvo()")
    pg.click("#settingsBtn"); pg.click(".tab[data-tab=inst]")
    pg.set_input_files("#presetPicker", write("shared-set.json", {"app": "cozy-chat", "kind": "instruction-set", "preset": {
        "name": "Shared RP set", "system": "You narrate.",
        "injections": [{"id": "a", "name": "Style", "text": "Write vividly.", "role": "system", "pos": "relative", "enabled": "true" + runs("set-switch")}],
        "order": ["__main__", "a", "__chat__"]}}))
    pg.wait_for_timeout(700)
    ck("setup: the shared set is imported", "Imported Shared RP set" in pg.text_content("#toast"), pg.text_content("#toast"))
    ck("nothing in an imported instruction set runs", not ran(pg), ran(pg))
    ck("its block shows in the list, switched on", pg.evaluate("document.querySelectorAll('#injList [data-injon]').length === 1 && document.querySelector('#injList [data-injon]').getAttribute('aria-checked') === 'true'"))
    ctx.close()

    ctx, pg = page_for()
    hostile = settings(
        providers=[{"id": "p1" + runs("connection-id"), "preset": "custom", "kind": "openai", "name": "T", "url": BASE + "/v1", "apiKey": "secret-key", "model": "m", "ctx": 200000}],
        activeProvider="p1" + runs("connection-id"),
        presets=[{"id": "d" + runs("set-id"), "name": "D", "system": "",
                  "injections": [{"id": "b" + runs("block-id"), "name": "Block", "text": "t", "role": "system", "pos": "relative", "enabled": "on" + runs("block-switch")}],
                  "order": ["__main__", "b" + runs("block-id"), "__chat__"]}],
        activePreset="d" + runs("set-id"),
        prompts=[{"id": "q" + runs("prompt-id"), "title": "Greeting", "text": "hello"}],
        projects=[{"id": "pj" + runs("project-id"), "name": "Story", "createdAt": 1, "docIds": ["f1"],
                   "injections": [{"id": "pb" + runs("project-block-id"), "name": "PB", "text": "x", "role": "system", "pos": "relative", "enabled": 1}],
                   "order": ["__main__", "pb" + runs("project-block-id"), "__chat__"]}])
    backup = {"app": "cozy-chat", "settings": hostile,
              "docs": [{"id": "f1", "name": "notes.md", "text": "hello", "updatedAt": 1}],
              "conversations": [
                  {"id": "c1", "title": "Shared chat", "createdAt": 1, "updatedAt": int(time.time() * 1000), "cfg": {},
                   "docIds": ["f1"], "filesOn": True,
                   "messages": [{"id": "m1" + runs("message-id"), "role": "user", "content": "hi"},
                                {"id": "m2", "role": "assistant" + runs("role"), "content": "odd"},
                                {"id": "m3", "role": "user", "content": "again"},
                                {"id": "m4" + runs("reply-id"), "role": "assistant", "content": "hello", "model": "m", "sent": {"chat": "c", "id": "s", "tokens": 3},
                                 "approvals": [{"id": "ap" + runs("approval-id"), "status": "pending", "choices": ["once" + runs("choice"), "deny"], "command": "ls"}],
                                 "variants": [{"content": "first"}, {"content": "hello"}], "vi": "1" + runs("version")}]},
                  {"id": "c2", "title": "Old chat", "archived": True, "createdAt": 1, "updatedAt": 1, "cfg": {}, "messages": [{"id": "x" + runs("archived-message-id"), "role": "user", "content": "old"}]},
                  {"id": "c3", "title": "Project chat", "createdAt": 1, "updatedAt": 5, "cfg": {}, "projectId": "pj" + runs("project-id"), "messages": []}]}
    pg.click("#settingsBtn"); pg.click(".tab[data-tab=app]")
    pg.set_input_files("#filePicker", write("refused.json", {"app": "cozy-chat", "conversations": [{"id": "c9" + runs("chat-id"), "title": "x", "messages": []}]}))
    pg.wait_for_timeout(700)
    ck("a backup whose chat id carries markup is refused, and nothing in it runs", "Nothing was restored" in pg.text_content("#toast") and not ran(pg), pg.text_content("#toast"))
    pg.set_input_files("#filePicker", write("backup.json", backup))
    pg.wait_for_timeout(900)
    ck("setup: the backup is restored", "Restored" in pg.text_content("#toast"), pg.text_content("#toast"))
    pg.click("#closeSettings"); pg.wait_for_timeout(300)
    pg.evaluate("openDrawer()"); pg.wait_for_timeout(300)
    row = pg.locator("#convoList .convo", has_text="Shared chat")
    if row.count():
        row.first.click()
    pg.wait_for_timeout(400)
    ck("the restored chat opens from the sidebar", pg.evaluate("current && current.title") == "Shared chat", pg.evaluate("current && current.title"))
    ck("nothing in the restored chat runs (ids, role, version, approval)", not ran(pg), ran(pg))
    pg.evaluate("closeDrawer(); document.querySelector('#fileBtn').click()"); pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('#settingsBtn').click()"); pg.wait_for_timeout(200)
    for tab in ("conn", "chat", "inst"):
        pg.evaluate("document.querySelector('.tab[data-tab=%s]').click()" % tab); pg.wait_for_timeout(250)
    ck("nothing runs in Settings (connections, project picker, sets, blocks)", not ran(pg), ran(pg))
    pg.evaluate("closeSettings()"); pg.wait_for_timeout(300)
    for opener in ("openDocs()", "closeDocs(); openPrompts()", "closePrompts(); openArchive()", "closeArchive(); openProjEditor(S.projects[0].id)"):
        pg.evaluate(opener); pg.wait_for_timeout(350)
    ck("nothing runs in Files, saved prompts, the archive or the project editor", not ran(pg), ran(pg))
    ck("no page error", not pg.errors, pg.errors)
    ctx.close()
    print("=== 2. A FINGER ON A MESSAGE'S HIDDEN ACTIONS ONLY SHOWS THEM ===")
    ctx, pg = page_for()
    pg.evaluate("""() => { newConvo(); current.messages.push({id:'u0',role:'user',content:'My careful question'},{id:'a0',role:'assistant',content:'A long answer.'},
        {id:'u1',role:'user',content:'Follow-up'},{id:'a1',role:'assistant',content:'Second answer.'}); renderThread(); persist(); }""")
    pg.wait_for_timeout(300)
    SPOT = """(sel) => { const b = document.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(), bar = b.closest('.msg-actions');
        return {x: r.left + r.width / 2, y: r.top + r.height / 2, opacity: getComputedStyle(bar).opacity}; }"""

    def tap_at(sel):
        sp = pg.evaluate(SPOT, sel)
        if sp:
            pg.touchscreen.tap(sp["x"], sp["y"])
        pg.wait_for_timeout(400)
        return sp

    sp = pg.evaluate(SPOT, "[data-delmsg=u0]")
    ck("setup: the first message's Delete is hidden", sp and sp["opacity"] == "0", sp and sp["opacity"])
    tap_at("[data-delmsg=u0]")
    ck("a tap where the hidden Delete sits deletes nothing", pg.evaluate("current.messages.length") == 4, pg.evaluate("current.messages.map(m => m.content)"))
    sp = pg.evaluate(SPOT, "[data-delmsg=u0]")
    ck("it shows the message's actions", sp and sp["opacity"] == "1", sp and sp["opacity"])
    tap_at("[data-delmsg=u0]")
    ck("a tap on it, showing, deletes it", pg.evaluate("current.messages.length") == 3 and not pg.evaluate("current.messages.some(m => m.id === 'u0')"))
    n = len(CALLS)
    tap_at("[data-continue=a1]")
    pg.wait_for_timeout(200)
    ck("a tap on the newest reply's hidden More asks for nothing", len(CALLS) == n and pg.evaluate("current.messages.slice(-1)[0].content") == "Second answer.", len(CALLS) - n)
    # a finger scrolls over a message, then a mouse clicks one of its buttons: the mouse is not a blind finger
    cdp = ctx.new_cdp_session(pg)
    b = pg.evaluate("""() => { const r = document.querySelector('[data-delmsg=u1]').closest('.msg').querySelector('.msg-body').getBoundingClientRect(); return {x: r.left + 20, y: r.top + r.height / 2}; }""")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": b["x"], "y": b["y"]}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": b["x"], "y": b["y"] - 30}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    pg.wait_for_timeout(100)
    pg.click("[data-delmsg=u1]"); pg.wait_for_timeout(400)
    ck("a mouse click on Delete right after a finger scrolled over the message deletes it", not pg.evaluate("current.messages.some(m => m.id === 'u1')"))
    # the sidebar: a finger on another chat's hidden Archive opens that chat instead of archiving it
    pg.evaluate("""async () => { for (const t of ['First chat','Second chat']){ newConvo(); current.title=t; current.messages.push({id:'x'+t[0],role:'user',content:t}); await persist(); } openDrawer(); }""")
    pg.wait_for_timeout(500)
    sp = pg.evaluate("""() => { const row = [...document.querySelectorAll('#convoList .convo')].find(r => r.querySelector('.convo-title').textContent === 'First chat');
        const b = row.querySelector('.convo-arch'), r = b.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2, opacity: getComputedStyle(b).opacity}; }""")
    pg.touchscreen.tap(sp["x"], sp["y"]); pg.wait_for_timeout(500)
    ck("a finger on another chat's hidden Archive does not archive it", sp["opacity"] == "0" and not pg.evaluate("convos.find(c => c.title === 'First chat').archived"))
    ck("it opens that chat instead", pg.evaluate("current.title") == "First chat", pg.evaluate("current.title"))
    ck("no page error", not pg.errors, pg.errors)
    ctx.close()
    print("=== 3. A LONG MODEL ID NEVER PUSHES A MESSAGE'S BUTTONS OFF THE SCREEN ===")
    ctx, pg = page_for()
    FIT = """() => { const vw = innerWidth, t = document.querySelector('#thread');
        const heads = [...document.querySelectorAll('#threadInner .msg-head')];
        const out = heads.flatMap(h => [...h.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > vw; })
                                                                   .map(b => b.textContent || b.getAttribute('aria-label')));
        return {offscreen: out, sideways: t.scrollWidth > t.clientWidth,
                labels: [...document.querySelectorAll('#threadInner .msg.assistant .msg-head .lbl')].map(l => l.textContent)}; }"""
    for model in ("anthropic/claude-sonnet-4.5", "moonshotai/kimi-k2-instruct-0905", "deepseek/deepseek-chat-v3.1",
                  "accounts/fireworks/models/deepseek-v3p1-terminus", "averyveryverylongmodelnamewithoutanybreakopportunityatall-2026"):
        pg.evaluate("""(model) => { newConvo(); current.messages.push({id:'u0',role:'user',content:'hi'},{id:'a0',role:'assistant',content:'older',model:model},
            {id:'u1',role:'user',content:'again'},{id:'a1',role:'assistant',content:'v2',model:model,variants:[{content:'v1'},{content:'v2'}],vi:1}); renderThread(); }""", model)
        pg.wait_for_timeout(250)
        r = pg.evaluate(FIT)
        ck("%s: every button of every message is on the screen" % model, not r["offscreen"], r["offscreen"])
        ck("%s: the thread does not scroll sideways" % model, not r["sideways"])
        ck("%s: the model's name is shown whole" % model, r["labels"] == [model.upper(), model.upper()] or r["labels"] == [model, model], r["labels"])
    # the newest reply's Delete, shown by a first tap, is reachable and works
    sp = pg.evaluate("""() => { const b = document.querySelector('[data-delmsg=a1]').closest('.msg').querySelector('.msg-body'); const r = b.getBoundingClientRect(); return {x: r.left + 10, y: r.top + r.height / 2}; }""")
    pg.touchscreen.tap(sp["x"], sp["y"]); pg.wait_for_timeout(300)
    sp = pg.evaluate("""() => { const b = document.querySelector('[data-delmsg=a1]'), r = b.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right, vw: innerWidth}; }""")
    pg.touchscreen.tap(sp["x"], sp["y"]); pg.wait_for_timeout(400)
    ck("with the longest name, the newest reply's Delete is tapped and deletes it", pg.evaluate("current.messages.length") == 3, "%s / %s px" % (sp["right"], sp["vw"]))
    ck("no page error", not pg.errors, pg.errors)
    ctx.close()
    br.close()

SRV.shutdown()
shutil.rmtree(D, ignore_errors=True)
print("\n" + ("FAILED %d" % failed if failed else "ALL PASS") + "  (%d checks)" % (passed + failed))
sys.exit(1 if failed else 0)
