# TEST FILE - run with: python3 tests/thinking_e2e.py [checkout]
# The thinking box, measured in real Chromium on a phone-sized screen against a
# reply that is really streaming: it follows its own end while the reader is
# at that end, it stays exactly where the reader put it otherwise, and a
# rebuild of the thread forgets neither. Fingers are real touch events (CDP
# Input.dispatchTouchEvent), the wheel is a real wheel. jsdom has no layout, so
# none of this can be measured there.
# Needs: pip install playwright && playwright install chromium.
import json, os, sys, threading, time, http.server, socket
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = failed = 0


def ck(name, ok, extra=""):
    global passed, failed
    print(("  ok   " if ok else "  FAIL ") + name + (("  -> " + str(extra)) if extra != "" else ""))
    if ok:
        passed += 1
    else:
        failed += 1


WORDS = ("the user wants a story about a fox and a crow so I should think about the fable first then decide "
         "which details matter most for the scene and how the tension builds before the crow drops the cheese").split()


def sentence(n):
    return " ".join(WORDS[(n * 7 + i) % len(WORDS)] for i in range(14)).capitalize() + ". "


# What the next request streams. "bursts" sends whole paragraphs at once, the
# way a fast service (or a slow frame) delivers them.
PLAN = {"bursts": False, "stop": threading.Event(), "hold": threading.Event(), "answer": ["The fox ", "looked up ", "at the crow."]}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def chunk(self, delta):
        self.wfile.write(b"data: " + json.dumps({"choices": [{"delta": delta}]}).encode() + b"\n\n")
        self.wfile.flush()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        if not self.path.endswith("/chat/completions"):
            self.send_response(404); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        bursts, stop = PLAN["bursts"], PLAN["stop"]
        try:
            k = 0
            while not stop.is_set() and k < 6000:
                while PLAN["hold"].is_set() and not stop.is_set():   # the service goes quiet for a moment
                    time.sleep(0.01)
                if bursts:
                    self.chunk({"reasoning_content": "".join(sentence(k + j) for j in range(4)) + "\n\n"})
                    time.sleep(0.18)
                else:
                    s = sentence(k // 6)
                    self.chunk({"reasoning_content": s[(k % 6) * 15:(k % 6) * 15 + 15] + ("\n\n" if k % 24 == 23 else "")})
                    time.sleep(0.015)
                k += 1
            for piece in PLAN["answer"]:
                self.chunk({"content": piece})
                time.sleep(0.02)
            self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


sk = socket.socket(); sk.bind(("127.0.0.1", 0)); PORT = sk.getsockname()[1]; sk.close()
SRV = Server(("127.0.0.1", PORT), Handler)
threading.Thread(target=SRV.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % PORT
SETTINGS = {
    "providers": [{"id": "p1", "preset": "custom", "kind": "openai", "name": "T", "url": BASE + "/v1", "apiKey": "k", "model": "m", "ctx": 100000}],
    "activeProvider": "p1", "presets": [{"id": "d", "name": "D", "system": "", "injections": [], "order": ["__main__", "__chat__"]}],
    "activePreset": "d", "prompts": [], "maxTokens": 4096, "effort": "off", "showThinking": True,
    "catchThinkTags": True, "thinkTags": "think", "enterSends": False, "autoTitle": False, "theme": "dark",
    "search": {"on": False, "provider": "native", "key": "", "count": 5, "relay": "", "always": False}}

BOX = ".msg.assistant:last-of-type .think-body"
STATE = """() => { const b = document.querySelector('%s'); if (!b) return null; const d = b.closest('details');
  return { top: b.scrollTop, h: b.scrollHeight, c: b.clientHeight, dist: b.scrollHeight - b.scrollTop - b.clientHeight,
           open: !!(d && d.open), len: b.textContent.length }; }""" % BOX

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2.625, is_mobile=True, has_touch=True)
    ctx.add_init_script("localStorage.setItem('cozychat:settings', %s)" % json.dumps(json.dumps(SETTINGS)))
    page = ctx.new_page()
    page.goto(BASE + "/index.html")
    page.wait_for_selector("#input")
    page.wait_for_timeout(700)
    cdp = ctx.new_cdp_session(page)

    def st():
        return page.evaluate(STATE)

    def watch(ms, every=60):
        """Samples taken with nobody touching anything, over ms."""
        out, t0 = [], time.time()
        while (time.time() - t0) * 1000 < ms:
            v = st()
            if v: out.append(v)
            page.wait_for_timeout(every)
        return out

    def following(rows):
        rows = [v for v in rows if v["h"] > v["c"] + 5]          # only once the box can scroll at all
        return rows, [v for v in rows if v["dist"] > 2]

    def finger(dy, hold=120):
        """A real finger on the box: down, drag dy px (positive = finger moves down =
        the text scrolls back up), hold still, lift - no fling."""
        r = page.eval_on_selector(BOX, "b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
        x, y = r[0], r[1] - dy / 2
        steps = max(1, int(abs(dy) / 12))
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, steps + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y + dy * i / steps}]})
            page.wait_for_timeout(16)
        page.wait_for_timeout(hold)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def finger_to_end():
        """Drag up until the box will not go further, hold, lift. Returns the state while held."""
        r = page.eval_on_selector(BOX, "b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height - 12]; }")
        x, y = r
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        held = None
        for i in range(500):
            y -= 12
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
            page.wait_for_timeout(16)
            held = st()
            if held["dist"] <= 1:
                break
        page.wait_for_timeout(150)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        return held

    def wheel(dy):
        r = page.eval_on_selector(BOX, "b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
        page.mouse.move(r[0], r[1])
        page.mouse.wheel(0, dy)

    def ask(text, bursts=False):
        PLAN["bursts"] = bursts
        PLAN["stop"] = threading.Event()
        page.fill("#input", text)
        page.click("#sendBtn")
        page.wait_for_function("() => { const b = document.querySelector('%s'); return b && b.scrollHeight > b.clientHeight + 40; }" % BOX, timeout=20000)

    def finish():
        PLAN["stop"].set()
        page.wait_for_function("() => streaming === null", timeout=20000)
        page.wait_for_timeout(300)

    print("=== 1. HANDS OFF, IT FOLLOWS ITS END ===")
    ask("Tell me the fable")
    rows, off = following(watch(1500))
    ck("token-sized pieces: the box is at its end at every look", len(rows) >= 10 and not off,
       "%d looks, %d behind (worst %s px)" % (len(rows), len(off), max([v["dist"] for v in off], default=0)))
    finish()

    print("=== 2. WHOLE PARAGRAPHS AT ONCE, IT STILL FOLLOWS ===")
    # A paint that grows the box by more than the margin used to read as
    # "the reader scrolled away" - every burst of a fast service did that.
    ask("Again, fast", bursts=True)
    rows, off = following(watch(2200))
    grew = rows and max(v["h"] for v in rows) - min(v["h"] for v in rows)
    ck("paragraph bursts: the box is at its end at every look", len(rows) >= 10 and not off,
       "%d looks, %d behind (worst %s px), grew %s px" % (len(rows), len(off), max([v["dist"] for v in off], default=0), grew))
    finish()

    print("=== 3. THE READER SCROLLS UP: IT STAYS WHERE THEY PUT IT ===")
    ask("Once more")
    watch(500)
    finger(170)
    page.wait_for_timeout(400)
    a = st()
    rows = watch(1500)
    ck("after the finger lifts, the box is away from its end", a["dist"] > 60, a)
    ck("and stays exactly there while the thinking grows",
       all(abs(v["top"] - a["top"]) <= 1 for v in rows) and rows[-1]["h"] > a["h"] + 60,
       "top %s..%s, height %s -> %s" % (min(v["top"] for v in rows), max(v["top"] for v in rows), a["h"], rows[-1]["h"]))

    print("=== 4. THE READER COMES BACK TO THE END: IT FOLLOWS AGAIN ===")
    held = finger_to_end()
    page.wait_for_timeout(400)
    rows, off = following(watch(1800))
    ck("the finger reached the end", held["dist"] <= 1, held)
    ck("after it lifts, the box follows again at every look", len(rows) >= 10 and not off,
       "%d looks, %d behind (worst %s px)" % (len(rows), len(off), max([v["dist"] for v in off], default=0)))

    print("=== 5. A WHEEL OR A TOUCHPAD ===")
    wheel(-120)
    page.wait_for_timeout(400)
    a = st()
    rows = watch(1000)
    ck("one wheel notch up: the box stays where the wheel put it",
       a["dist"] > 60 and all(abs(v["top"] - a["top"]) <= 1 for v in rows), "top %s, then %s..%s" % (a["top"], min(v["top"] for v in rows), max(v["top"] for v in rows)))
    wheel(4000)
    page.wait_for_timeout(500)
    rows, off = following(watch(1000))
    ck("wheeled back to the end: it follows again", len(rows) >= 6 and not off, "%d behind" % len(off))
    # a touchpad's small step, inside the margin. The service goes quiet for
    # the step itself, so where the box stood and where the step left it are
    # both exact; then the thinking carries on and it must not be pulled back.
    PLAN["hold"].set()
    page.wait_for_timeout(300)
    a0 = st()
    wheel(-15)
    page.wait_for_timeout(300)
    a = st()
    PLAN["hold"].clear()
    rows = watch(1200)
    ck("a 15px step up from the end moves the box 15px", a0["dist"] <= 1 and 10 <= a0["top"] - a["top"] <= 20,
       "before %s (dist %s), after %s" % (a0["top"], a0["dist"], a["top"]))
    ck("and it is not pulled back to the end as the thinking carries on",
       all(abs(v["top"] - a["top"]) <= 1 for v in rows) and rows[-1]["h"] > a["h"] + 40,
       "top %s..%s, height %s -> %s" % (min(v["top"] for v in rows), max(v["top"] for v in rows), a["h"], rows[-1]["h"]))
    wheel(4000)
    page.wait_for_timeout(500)

    print("=== 6. A REBUILD OF THE THREAD MID-REPLY ===")
    # renderThread() is what an approval tap, settings arriving from the phone,
    # or a chat change from another browser runs while a reply streams.
    rows, off = following(watch(400))
    ck("before the rebuild it is following", rows and not off, "%d behind" % len(off))
    page.evaluate("renderThread()")
    page.wait_for_timeout(100)
    rows, off = following(watch(1200))
    ck("the rebuilt live block is still open", rows and all(v["open"] for v in rows))
    ck("and still follows its end", len(rows) >= 8 and not off, "%d behind (worst %s px)" % (len(off), max([v["dist"] for v in off], default=0)))
    finger(170)
    page.wait_for_timeout(400)
    a = st()
    page.evaluate("renderThread()")
    page.wait_for_timeout(100)
    b = st()
    rows = watch(1000)
    ck("a reader up in the box keeps their place through a rebuild", abs(b["top"] - a["top"]) <= 1 and b["open"],
       "before %s, after %s" % (a["top"], b["top"]))
    ck("and it does not start following", all(abs(v["top"] - a["top"]) <= 1 for v in rows), "top %s..%s" % (min(v["top"] for v in rows), max(v["top"] for v in rows)))
    finger_to_end()
    page.wait_for_timeout(400)

    print("=== 7. THE READER FOLDS THE LIVE BLOCK ===")
    page.tap(".msg.assistant:last-of-type details.think > summary", position={"x": 20, "y": 8})
    page.wait_for_timeout(300)
    ck("tapping its title folds it", st()["open"] is False)
    page.evaluate("renderThread()")
    page.wait_for_timeout(200)
    ck("a rebuild keeps it folded", st()["open"] is False)
    page.tap(".msg.assistant:last-of-type details.think > summary", position={"x": 20, "y": 8})
    page.wait_for_timeout(400)
    rows, off = following(watch(1000))
    ck("unfolded again, it is open at its end and following", rows and all(v["open"] for v in rows) and not off,
       "%d behind" % len(off))

    print("=== 8. TEXT SELECTED IN THE BOX SURVIVES THE STREAM ===")
    page.evaluate("""() => { const b = document.querySelector('%s'); const t = b.firstChild;
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 24);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); window.__sel = s.toString(); }""" % BOX)
    l0 = st()["len"]
    page.wait_for_timeout(800)
    sel = page.evaluate("getSelection().toString()")
    ck("the selection is still there after the box grew", sel == page.evaluate("window.__sel") and st()["len"] > l0 + 40,
       repr(sel))
    page.evaluate("getSelection().removeAllRanges()")

    print("=== 9. THE REPLY FINISHES ===")
    finish()
    ck("a block the reader folded and unfolded stays open when the reply is done", st()["open"] is True)
    ask("And one nobody touches")
    watch(500)
    finish()
    ck("a block the reader only watched folds when the reply is done", st()["open"] is False)
    ask("And one I read while it arrives")
    watch(500)
    finger(170)
    page.wait_for_timeout(400)
    a = st()
    finish()
    b = st()
    ck("a block the reader is up in stays open when the reply is done", b["open"] is True, b)
    ck("at the same place", abs(b["top"] - a["top"]) <= 1, "before %s, after %s" % (a["top"], b["top"]))

    print("=== 10. A NEW VERSION STARTS FOLLOWING FROM THE TOP ===")
    PLAN["stop"] = threading.Event(); PLAN["bursts"] = False
    page.click(".msg.assistant:last-of-type [data-regen]")
    page.wait_for_function("() => { const b = document.querySelector('%s'); return b && b.scrollHeight > b.clientHeight + 40; }" % BOX, timeout=20000)
    rows, off = following(watch(1200))
    ck("Swipe: the new version's thinking is open and follows", len(rows) >= 8 and all(v["open"] for v in rows) and not off,
       "%d looks, %d behind" % (len(rows), len(off)))
    finish()
    br.close()

SRV.shutdown()
print("\n" + ("FAILED %d" % failed if failed else "ALL PASS") + "  (%d checks)" % (passed + failed))
sys.exit(1 if failed else 0)
