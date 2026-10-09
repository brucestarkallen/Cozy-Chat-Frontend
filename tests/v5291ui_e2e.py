# TEST FILE - run with: python3 tests/v5291ui_e2e.py [checkout]
# The interface in real Chromium on a phone-sized screen (412 x 915, DPR
# 2.625, touch), for what jsdom cannot show - layout, scrolling, what the page
# fetches by itself:
#   1. a fast reply never runs off the screen while the thread follows it, and
#      the reader's own scrolls are never swallowed
#   2. a picture from another address in a reply is not fetched until it is
#      tapped; the tap fetches it, and inside a link does not follow the link
#   3. Settings' "belongs to this chat" note is on screen only with the
#      settings that belong to the chat
#   4. on a page served over plain http (Cozy on a phone, opened from another
#      device), which has no clipboard, Copy still copies and says so
#   5. a long unbroken tool name in an approval card - or a chat title, or a
#      project name, in Settings - stays inside the 412 px screen
# Needs: pip install playwright && playwright install chromium.
import json, os, socket, sys, threading, time, http.server
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = failed = 0


def ck(name, ok, extra=""):
    global passed, failed
    ok = bool(ok)
    print(("  ok   " if ok else "  FAIL ") + name + (("  -> " + str(extra)) if extra != "" else ""))
    passed += ok
    failed += (not ok)


# ---------- a service that streams what PLAN says, and a host for pictures ----------
PLAN = {"chunks": ["Hello."], "delay": 0.02}
CALLS, PICS = [], []
GIF = bytes.fromhex("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(s, *a):
        pass

    def do_GET(s):
        if s.path.startswith("/pic/"):
            PICS.append(s.path)
            s.send_response(200); s.send_header("Content-Type", "image/gif"); s.end_headers(); s.wfile.write(GIF)
            return
        return super().do_GET()

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


def lan_ip():
    # an address of this machine that is not loopback: a page from it is not a secure context
    try:
        u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.connect(("192.0.2.1", 9)); ip = u.getsockname()[0]; u.close()
        return ip if not ip.startswith("127.") else ""
    except OSError:
        return ""
SRV = S(("127.0.0.1", PORT), H)
threading.Thread(target=SRV.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % PORT


def settings(**o):
    st = {"providers": [{"id": "p1", "preset": "custom", "kind": "openai", "name": "T", "url": BASE + "/v1", "apiKey": "k", "model": "m", "ctx": 200000}],
          "activeProvider": "p1", "presets": [{"id": "d", "name": "D", "system": "", "injections": [], "order": ["__main__", "__chat__"]}],
          "activePreset": "d", "prompts": [], "maxTokens": 1024, "effort": "off", "showThinking": True, "catchThinkTags": True, "thinkTags": "think",
          "enterSends": False, "autoTitle": False, "theme": "dark", "search": {"on": False, "provider": "native", "key": "", "count": 5, "relay": "", "always": False}}
    st.update(o)
    return st


WORDS = "the fox looked up at the crow and said something clever about the cheese while the wind moved the leaves".split()


def story(n, per):
    return [(" ".join(WORDS[(i * 3 + j) % len(WORDS)] for j in range(per)) + (".\n\n" if i % 8 == 7 else " ")) for i in range(n)]


FOLLOW = """() => { const t = document.querySelector('#thread'), c = document.querySelector('#threadInner .caret');
  const r = c && c.getBoundingClientRect(), tr = t.getBoundingClientRect();
  return {below: Math.round(t.scrollHeight - t.clientHeight - t.scrollTop), caret: !!(r && r.top < tr.bottom && r.bottom > tr.top),
          pinned: pinned, top: Math.round(t.scrollTop), latest: document.querySelector('#jumpBtn').classList.contains('show')}; }"""

with sync_playwright() as pw:
    br = pw.chromium.launch()

    def page_for(st=None, touch=True):
        ctx = br.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2.625, is_mobile=touch, has_touch=touch)
        ctx.add_init_script("if (!localStorage.getItem('cozychat:settings')) localStorage.setItem('cozychat:settings', %s)" % json.dumps(json.dumps(st or settings())))
        pg = ctx.new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        pg.on("dialog", lambda dlg: dlg.accept())
        pg.goto(BASE + "/index.html"); pg.wait_for_selector("#input"); pg.wait_for_timeout(600)
        return ctx, pg

    print("=== 1. A FAST REPLY IS FOLLOWED, AND THE READER'S SCROLLS ARE THEIRS ===")
    for label, n, per, delay in (("100 pieces a second, a word each", 700, 1, 0.01), ("50 pieces a second, five words each", 300, 5, 0.02)):
        PLAN["chunks"], PLAN["delay"] = story(n, per), delay
        ctx, pg = page_for()
        pg.evaluate("newConvo()")
        pg.fill("#input", "tell me a long story"); pg.click("#sendBtn")
        rows = []
        t0 = time.time()
        while time.time() - t0 < 6:
            pg.wait_for_timeout(500)
            rows.append(pg.evaluate(FOLLOW))
        live = [r for r in rows if r["below"] >= 0]
        ck("%s: the newest words stay on the screen while they arrive" % label, max(r["below"] for r in live) <= 120,
           "px below the screen: %s" % [r["below"] for r in live])
        ck("%s: the caret is in view at every look" % label, all(r["caret"] for r in live[:-1]), [r["caret"] for r in live])
        pg.wait_for_function("() => !streaming", timeout=60000); pg.wait_for_timeout(800)
        end = pg.evaluate(FOLLOW)
        ck("%s: at the end the view is at the end" % label, end["below"] <= 2 and end["pinned"], end)
        # the reader scrolls up with the wheel: theirs, at once
        pg.mouse.move(200, 400)
        for _ in range(4):
            pg.mouse.wheel(0, -500); pg.wait_for_timeout(120)
        pg.wait_for_timeout(500)
        up = pg.evaluate(FOLLOW)
        ck("%s: scrolling up afterwards lets go of the end and offers Latest" % label, up["below"] > 400 and not up["pinned"] and up["latest"], up)
        ctx.close()
    # the reader scrolls up WHILE a fast reply arrives: nothing drags them back
    PLAN["chunks"], PLAN["delay"] = story(700, 1), 0.01
    ctx, pg = page_for(touch=False)
    pg.evaluate("newConvo()")
    pg.fill("#input", "tell me a long story"); pg.click("#sendBtn")
    pg.wait_for_timeout(2500)
    pg.mouse.move(200, 400)
    for _ in range(5):
        pg.mouse.wheel(0, -400); pg.wait_for_timeout(100)
    pg.wait_for_timeout(400)
    a = pg.evaluate(FOLLOW)
    pg.wait_for_timeout(1500)
    b = pg.evaluate(FOLLOW)
    ck("reading up during a fast reply: the reader lets go of the end", a["below"] > 400 and not a["pinned"] and a["latest"], a)
    ck("and stays where they put it while the reply goes on", abs(b["top"] - a["top"]) <= 2 and not b["pinned"], "%s then %s" % (a["top"], b["top"]))
    if b["latest"]:
        pg.click("#jumpBtn")
    else:
        pg.evaluate("document.querySelector('#jumpBtn').click()")   # not offered: what tapping it would do
    pg.wait_for_timeout(300)
    rows = []
    for _ in range(4):
        pg.wait_for_timeout(400); rows.append(pg.evaluate(FOLLOW))
    ck("Latest takes them back, and the reply is followed again", all(r["below"] <= 120 for r in rows) and rows[-1]["pinned"], [r["below"] for r in rows])
    pg.wait_for_function("() => !streaming", timeout=60000)
    ck("no page error", not pg.errors, pg.errors)
    ctx.close()

    print("\n=== 2. A PICTURE FROM ANOTHER ADDRESS IS NOT FETCHED UNTIL IT IS TAPPED ===")
    del PICS[:]
    LONG = "a_description_written_as_one_word_that_goes_on_and_on_" * 3
    reply = ("Here is the chart:\n\n![chart](%s/pic/one.gif?q=what-the-user-said)\n\n"
             "and the badge [![badge](%s/pic/two.gif)](%s/elsewhere)\n\n![%s](%s/pic/three.gif)" % (BASE, BASE, BASE, LONG, BASE))
    PLAN["chunks"], PLAN["delay"] = [reply[i:i + 20] for i in range(0, len(reply), 20)], 0.02
    ctx, pg = page_for()
    pg.evaluate("newConvo()")
    pg.fill("#input", "show me the chart"); pg.click("#sendBtn")
    pg.wait_for_function("() => !streaming", timeout=30000); pg.wait_for_timeout(1000)
    phs = pg.evaluate("() => [...document.querySelectorAll('#threadInner .md-img-ph')].map(b => b.textContent)")
    ck("while the reply arrived and after it, nothing was fetched from the picture's address", PICS == [], PICS)
    ck("each picture is a button naming where it would come from", len(phs) == 3 and all(("127.0.0.1:%d" % PORT) in x and "tap to show" in x for x in phs), phs)
    fit = pg.evaluate("() => { const t = document.querySelector('#thread'); return {wide: Math.max(...[...document.querySelectorAll('#threadInner .md-img-ph')].map(b => Math.round(b.getBoundingClientRect().right))), over: t.scrollWidth - t.clientWidth}; }")
    ck("a long one fits the screen", phs and fit["wide"] <= 412 and fit["over"] <= 0, fit)
    if phs:
        del PICS[:]
        pg.tap("#threadInner .md-img-ph >> nth=0")
        pg.wait_for_function("() => { const i = document.querySelector('#threadInner img.md-img'); return i && i.complete && i.naturalWidth > 0; }", timeout=10000)
        ck("tapping one fetches that picture, and only it", PICS == ["/pic/one.gif?q=what-the-user-said"], PICS)
        pg.tap("#threadInner a .md-img-ph")
        pg.wait_for_timeout(1200)
        shown = pg.evaluate("() => !!document.querySelector('#threadInner a[href$=\"/elsewhere\"] img.md-img')")
        ck("tapping the one inside a link shows it there, and does not follow the link", "/pic/two.gif" in PICS and shown and len(ctx.pages) == 1 and pg.url.endswith("/index.html"),
           {"pics": PICS, "shown": shown, "pages": len(ctx.pages), "url": pg.url})
    else:
        ck("tapping one fetches that picture, and only it", False, "no button to tap")
        ck("tapping the one inside a link shows it there, and does not follow the link", False, "no button to tap")
    ck("no page error", not pg.errors, pg.errors)
    ctx.close()

    print("\n=== 3. \"BELONGS TO THIS CHAT\" IS ON SCREEN ONLY WITH THE SETTINGS THAT DO ===")
    ctx, pg = page_for()
    pg.evaluate("newConvo(); current.title = 'Bleach'; renderThread();")
    pg.click("#settingsBtn"); pg.wait_for_timeout(400)
    pg.click(".tab[data-tab=chat]"); pg.wait_for_timeout(300)
    # on screen means the reader sees it: what is drawn at its middle is the note itself
    NOTE = """() => { const n = document.querySelector('#scopeNote'), p = document.querySelector('[data-panel=chat]');
      const r = n.getBoundingClientRect(), pr = p.getBoundingClientRect();
      const hit = r.width > 0 && r.height > 0 ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return {visible: !!(hit && n.contains(hit)), wide: Math.round(r.width), panel: Math.round(pr.width)}; }"""
    top = pg.evaluate(NOTE)
    pg.screenshot(path=os.path.join(os.environ.get("SHOTS", "/tmp"), "v5291_chat_tab.png"))
    ck("Chat tab: the note heads it, across the sheet", top["visible"] and abs(top["wide"] - top["panel"]) <= 1, top)
    pg.evaluate("document.querySelector('#tgThink').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
    low = pg.evaluate(NOTE)
    seen = pg.evaluate("() => { const b = document.querySelector('#tgThink').getBoundingClientRect(), p = document.querySelector('[data-panel=chat]').getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom; }")
    pg.screenshot(path=os.path.join(os.environ.get("SHOTS", "/tmp"), "v5291_every_chat.png"))
    ck("with \"Show thinking\" on screen, the note has scrolled away with the chat's own settings", seen and not low["visible"], {"switch on screen": seen, "note": low})
    pg.click(".tab[data-tab=search]"); pg.wait_for_timeout(200)
    ck("Search tab: no note", not pg.is_visible("#scopeNote"))
    pg.click(".tab[data-tab=app]"); pg.wait_for_timeout(200)
    ck("App tab: no note", not pg.is_visible("#scopeNote"))
    ck("no page error", not pg.errors, pg.errors)
    ctx.close()

    print("\n=== 4. OVER PLAIN HTTP, WITH NO CLIPBOARD, COPY STILL COPIES AND SAYS SO ===")
    IP = lan_ip()
    if not IP:
        ck("this machine has an address other than loopback to serve from", False, "none found - the section cannot run here")
    else:
        LAN = S((IP, 0), H); threading.Thread(target=LAN.serve_forever, daemon=True).start()
        lan = "http://%s:%d" % (IP, LAN.server_address[1])
        ctx = br.new_context(viewport={"width": 412, "height": 915})
        ctx.add_init_script("if (!localStorage.getItem('cozychat:settings')) localStorage.setItem('cozychat:settings', %s)" % json.dumps(json.dumps(settings())))
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
        pg = ctx.new_page(); pg.errors = []; pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        pg.goto(lan + "/index.html"); pg.wait_for_selector("#input"); pg.wait_for_timeout(500)
        ck("setup: the page is not a secure context and has no clipboard", pg.evaluate("() => !window.isSecureContext && !navigator.clipboard"))
        pg.evaluate("""() => { current = {id:'q', title:'Q', cfg:defaultCfg(), messages:[{id:'u', role:'user', content:'hi'},
          {id:'a', role:'assistant', content:'Here:\\n\\n```js\\nlet x = 1;\\n```\\n\\nDone.', thinking:'first I think'}]}; renderThread(); }""")
        reader = ctx.new_page(); reader.goto(BASE + "/index.html"); reader.wait_for_selector("#input")

        def clip():
            try:
                return reader.evaluate("navigator.clipboard.readText()")
            except Exception as e:
                return "(could not read: %s)" % e
        pg.click("#threadInner [data-copycode]"); pg.wait_for_timeout(200)
        ck("a code block's Copy copies it, and says Copied", clip() == "let x = 1;" and pg.text_content("#threadInner [data-copycode]") == "Copied",
           [clip(), pg.text_content("#threadInner [data-copycode]")])
        pg.click("#threadInner [data-copythink]"); pg.wait_for_timeout(200)
        ck("the thinking's Copy copies it, and says Copied", clip() == "first I think" and pg.text_content("#threadInner [data-copythink]") == "Copied",
           [clip(), pg.text_content("#threadInner [data-copythink]")])
        pg.click("#threadInner [data-copy=a]"); pg.wait_for_timeout(200)
        ck("a message's Copy copies it, and says Copied", clip() == "Here:\n\n```js\nlet x = 1;\n```\n\nDone." and pg.text_content("#toast") == "Copied", [clip(), pg.text_content("#toast")])
        ck("no page error", not pg.errors, pg.errors)
        ctx.close(); LAN.shutdown()

    print("\n=== 5. A LONG UNBROKEN NAME STAYS INSIDE THE SCREEN ===")
    LONG = "write_file_in_the_workspace_" * 6
    ctx, pg = page_for()
    pg.evaluate("""(L) => { S.projects = [{id:'pj', name:'Project_' + L, injections:[], order:[], docIds:[], createdAt:1}]; saveSettings();
      newConvo(); current.title = 'Title_' + L; current.projectId = 'pj';
      current.messages.push({id:'u', role:'user', content:'go'}, {id:'a', role:'assistant', content:'Asking first.',
        approvals:[{id:'p1', status:'pending', tool:'mcp__filesystem__' + L, why:'It wants https://example.com/' + L, command:'rm -rf ./' + L, choices:['once','deny']}]});
      persist(); renderSidebar(); renderThread(); }""", LONG)
    pg.wait_for_timeout(400)
    wide = pg.evaluate("""() => { const t = document.querySelector('#thread'), c = document.querySelector('#threadInner .appr');
      return {sideways: t.scrollWidth - t.clientWidth, card: c ? Math.round(c.getBoundingClientRect().right) : null}; }""")
    ck("an approval card with a long tool name: the thread does not scroll sideways, the card ends on the screen", wide["sideways"] <= 0 and wide["card"] is not None and wide["card"] <= 412, wide)
    pg.click("#settingsBtn"); pg.wait_for_timeout(400)
    side = {}
    for tab in ("conn", "chat", "inst"):
        pg.click(".tab[data-tab=%s]" % tab); pg.wait_for_timeout(200)
        side[tab] = pg.evaluate("""(t) => { const p = document.querySelector('[data-panel=' + t + ']'), n = document.querySelector('#scopeNote');
          return Math.max(p.scrollWidth - p.clientWidth, n.offsetParent ? n.scrollWidth - n.clientWidth : 0); }""", tab)
    ck("Settings with a long chat title and project name: no tab, and not the note, runs past the screen", all(v <= 0 for v in side.values()), side)
    ck("no page error", not pg.errors, pg.errors)
    ctx.close()
    br.close()

SRV.shutdown()
print("\n" + ("FAILED %d" % failed if failed else "ALL PASS") + "  (%d checks)" % (passed + failed))
sys.exit(1 if failed else 0)
