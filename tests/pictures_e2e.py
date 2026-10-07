# TEST FILE - run with: python3 tests/pictures_e2e.py [checkout]
# Pictures for a vision model, measured in real Chromium (jsdom cannot decode
# a picture or draw one): what reaches the model from a sideways phone photo
# with GPS in it, a 48 MP photo, a screenshot, a see-through sticker, a picture
# sent on its own (OpenAI and Claude wires), and a chat full of pictures.
# Needs: pip install playwright pillow && playwright install chromium.
import base64, io, json, os, shutil, socket, sys, tempfile, threading, http.server
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = failed = 0


def ck(name, ok, extra=""):
    global passed, failed
    print(("  ok   " if ok else "  FAIL ") + name + (("  -> " + str(extra)) if extra != "" else ""))
    ok = bool(ok)
    passed += ok
    failed += (not ok)


# ---------- the pictures ----------
D = tempfile.mkdtemp(prefix="cozy-pics-")


def photo_like(w, h, noise):
    return Image.blend(Image.effect_noise((w, h), noise).convert("RGB"),
                       Image.linear_gradient("L").resize((w, h)).convert("RGB"), 0.6)


# a portrait phone photo as it looks upright: a red band along the top. The
# camera wrote it sideways with an orientation flag, and put where it was taken.
up = photo_like(3000, 4000, 40)
dr = ImageDraw.Draw(up)
dr.rectangle([0, 0, 2999, 399], fill=(220, 20, 20))
ex = Image.Exif()
ex[0x0112] = 6
ex[0x8825] = {1: "S", 2: (8.0, 39.0, 0.0), 3: "E", 4: (115.0, 13.0, 0.0)}
up.rotate(90, expand=True).save(os.path.join(D, "photo.jpg"), "JPEG", quality=85, exif=ex.tobytes())
photo_like(8000, 6000, 60).save(os.path.join(D, "big.jpg"), "JPEG", quality=92)          # 48 MP
sh = Image.new("RGB", (1080, 2400), (250, 250, 250))
dr = ImageDraw.Draw(sh)
for y in range(40, 2400, 36):
    dr.text((24, y), "Line %d: the fox looked up at the crow" % (y // 36), fill=(20, 20, 20))
sh.save(os.path.join(D, "shot.png"), "PNG")
st = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
ImageDraw.Draw(st).ellipse([56, 56, 456, 456], fill=(255, 200, 0, 255))
st.save(os.path.join(D, "sticker.png"), "PNG")
with open(os.path.join(D, "notapicture.heic"), "wb") as f:
    f.write(b"\x00\x00\x00\x18ftypheic" + os.urandom(4000))
PHOTO_BYTES = os.path.getsize(os.path.join(D, "photo.jpg"))

# ---------- a service that keeps every request ----------
REQS = []


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(s, *a):
        pass

    def do_POST(s):
        n = int(s.headers.get("Content-Length") or 0)
        body = s.rfile.read(n)
        REQS.append({"bytes": len(body), "body": json.loads(body)})
        s.send_response(200)
        s.send_header("Content-Type", "text/event-stream")
        s.end_headers()
        if s.path.endswith("/messages"):
            for ev in ({"type": "message_start", "message": {"usage": {}}},
                       {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                       {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "I see it."}},
                       {"type": "message_stop"}):
                s.wfile.write(b"event: " + ev["type"].encode() + b"\ndata: " + json.dumps(ev).encode() + b"\n\n")
        else:
            s.wfile.write(b'data: {"choices":[{"delta":{"content":"I see it."}}]}\n\ndata: [DONE]\n\n')


class S(http.server.ThreadingHTTPServer):
    daemon_threads = True


sk = socket.socket(); sk.bind(("127.0.0.1", 0)); PORT = sk.getsockname()[1]; sk.close()
SRV = S(("127.0.0.1", PORT), H)
threading.Thread(target=SRV.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % PORT


def settings(kind):
    return {"providers": [{"id": "p1", "preset": "custom", "kind": kind, "name": "V", "url": BASE + "/v1", "apiKey": "k", "model": "vision-model", "ctx": 200000}],
            "activeProvider": "p1", "presets": [{"id": "d", "name": "D", "system": "", "injections": [], "order": ["__main__", "__chat__"]}],
            "activePreset": "d", "prompts": [], "maxTokens": 1024, "effort": "off", "showThinking": True, "catchThinkTags": True, "thinkTags": "think",
            "enterSends": False, "autoTitle": False, "theme": "dark", "search": {"on": False, "provider": "native", "key": "", "count": 5, "relay": "", "always": False}}


def pictures(body):
    out = []
    for m in body.get("messages", []):
        c = m.get("content")
        if isinstance(c, list):
            for p in c:
                if p.get("type") == "image_url":
                    url = p["image_url"]["url"]
                    out.append((url[5:url.index(";")], url.split(",", 1)[1]))
                elif p.get("type") == "image":
                    out.append((p["source"]["media_type"], p["source"]["data"]))
    return out


def opened(mime, data):
    im = Image.open(io.BytesIO(base64.b64decode(data)))
    return im, im.getexif()


with sync_playwright() as pw:
    br = pw.chromium.launch()

    def page_for(kind):
        ctx = br.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2.625, is_mobile=True, has_touch=True)
        ctx.add_init_script("localStorage.setItem('cozychat:settings', %s)" % json.dumps(json.dumps(settings(kind))))
        pg = ctx.new_page()
        pg.goto(BASE + "/index.html"); pg.wait_for_selector("#input"); pg.wait_for_timeout(600)
        pg.evaluate("""() => { const t = document.querySelector('#toast'); window.__toasts = [];
            new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, {childList:true, characterData:true, subtree:true}); }""")
        return ctx, pg

    def attach(pg, *names):
        pg.set_input_files("#attachPicker", [os.path.join(D, n) for n in names])
        pg.wait_for_function("n => pendingAtts.length >= n || window.__toasts.length", arg=len(names), timeout=30000)
        pg.wait_for_timeout(200)

    def send(pg, text):
        n0 = len(REQS)
        pg.fill("#input", text)
        pg.evaluate("document.querySelector('#input').dispatchEvent(new Event('input', {bubbles:true}))")
        enabled = not pg.evaluate("document.querySelector('#sendBtn').disabled")
        pg.click("#sendBtn", force=True)
        # the request leaves only after the chat is saved, which takes longer
        # the more pictures it holds: wait for the request, then for the reply
        for _ in range(200):
            if len(REQS) > n0: break
            pg.wait_for_timeout(100)
        pg.wait_for_function("() => streaming === null", timeout=20000); pg.wait_for_timeout(150)
        return enabled, (REQS[-1] if len(REQS) > n0 else None)

    print("=== 1. A PHONE PHOTO, SIDEWAYS WITH AN ORIENTATION FLAG AND GPS ===")
    ctx, pg = page_for("openai")
    attach(pg, "photo.jpg")
    _, rq = send(pg, "What is in this photo?")
    (mime, data), = pictures(rq["body"])
    im, ex = opened(mime, data)
    w, h = im.size
    ck("it reaches the model upright (the red band is on top)", im.convert("RGB").getpixel((w // 2, int(h * 0.03))) == (220, 20, 20) and h > w,
       "size %s, top-middle %s" % (im.size, im.convert("RGB").getpixel((w // 2, int(h * 0.03)))))
    ck("at most 2048 px on its long edge", max(w, h) == 2048, im.size)
    ck("as a JPEG", mime == "image/jpeg" and im.format == "JPEG", mime)
    ck("with no orientation flag left to misread", ex.get(0x0112) in (None, 1), ex.get(0x0112))
    ck("and without the place it was taken", not ex.get_ifd(0x8825), dict(ex.get_ifd(0x8825)))
    ck("several times smaller than the camera's file", len(base64.b64decode(data)) * 3 < PHOTO_BYTES,
       "%d bytes, the camera's %d" % (len(base64.b64decode(data)), PHOTO_BYTES))

    print("=== 2. THREE PHOTOS IN ONE CHAT STAY UNDER HERMES' 10 MB ===")
    attach(pg, "photo.jpg"); send(pg, "And this one?")
    attach(pg, "photo.jpg"); send(pg, "And a third.")
    _, rq = send(pg, "Which was best?")
    ck("every picture still goes", len(pictures(rq["body"])) == 3, len(pictures(rq["body"])))
    ck("in a request far under 10 MB", rq["bytes"] < 4_000_000, "%d bytes" % rq["bytes"])

    print("=== 3. A SCREENSHOT AND A SEE-THROUGH STICKER ===")
    attach(pg, "shot.png", "sticker.png")
    _, rq = send(pg, "Read the screenshot")
    (m1, d1), (m2, d2) = pictures(rq["body"])[-2:]
    i1, _ = opened(m1, d1); i2, _ = opened(m2, d2)
    ck("the screenshot stays a sharp PNG", m1 == "image/png" and i1.format == "PNG", m1)
    ck("scaled to 2048 px tall with its shape kept", i1.size == (922, 2048), i1.size)
    ck("the sticker stays PNG", m2 == "image/png", m2)
    ck("and stays see-through", i2.convert("RGBA").getpixel((2, 2))[3] == 0 and i2.convert("RGBA").getpixel((256, 256))[3] == 255,
       (i2.convert("RGBA").getpixel((2, 2)), i2.convert("RGBA").getpixel((256, 256))))

    print("=== 4. A 48 MP PHOTO AND A FILE CHROME CANNOT OPEN ===")
    attach(pg, "big.jpg")
    got = pg.evaluate("pendingAtts.map(a => ({name:a.name, mime:a.mime, chars:a.data.length}))")
    ck("a 29 MB, 48 MP photo is taken", len(got) == 1 and got[0]["mime"] == "image/jpeg", got)
    ck("at a size any service takes", got and got[0]["chars"] < 2_000_000, got)
    pg.evaluate("pendingAtts = []; renderAttachTray()")
    pg.set_input_files("#attachPicker", files=[{"name": "notapicture.heic", "mimeType": "image/heic", "buffer": open(os.path.join(D, "notapicture.heic"), "rb").read()}])
    try:
        pg.wait_for_function("() => window.__toasts.some(t => /couldn't be opened/.test(t))", timeout=15000)
    except Exception:
        pass
    ck("a picture that cannot be opened says so by name, and nothing is attached",
       pg.evaluate("pendingAtts.length") == 0 and pg.evaluate("window.__toasts.some(t => /notapicture.heic couldn't be opened as a picture/.test(t))"),
       pg.evaluate("window.__toasts.slice(-1)"))

    print("=== 5. A PICTURE ON ITS OWN IS A MESSAGE ===")
    attach(pg, "sticker.png")
    ck("Send is ready with only a picture in the tray", not pg.evaluate("document.querySelector('#sendBtn').disabled"))
    en, rq = send(pg, "")
    last = rq and rq["body"]["messages"][-1]["content"]
    ck("it goes", bool(rq) and isinstance(last, list) and last[0]["type"] == "image_url", json.dumps(last)[:120] if last else None)
    ck("with no empty text part beside it", bool(rq) and all(p["type"] != "text" for p in last), [p["type"] for p in last] if last else None)
    ck("and Send is greyed out again once it has gone", pg.evaluate("document.querySelector('#sendBtn').disabled"))
    ctx.close()
    ctx, pg = page_for("anthropic")
    attach(pg, "sticker.png")
    _, rq = send(pg, "")
    last = rq and rq["body"]["messages"][-1]["content"]
    ck("to Claude too, as a picture with no whitespace text (Claude refuses one)",
       bool(rq) and [p["type"] for p in last] == ["image"], [(p["type"], p.get("text")) for p in last] if last else None)

    print("=== 6. A CHAT FULL OF PICTURES ===")
    for i in range(8):
        attach(pg, "photo.jpg")
        send(pg, "photo %d" % (i + 1))
    _, rq = send(pg, "Which of all these was the best?")
    sent = pictures(rq["body"])
    notes = sum(json.dumps(m["content"]).count("is not sent again") for m in rq["body"]["messages"] if m["role"] == "user")
    ck("the request stays under Hermes' 10 MB", rq["bytes"] < 10_000_000, "%d bytes" % rq["bytes"])
    ck("the newest pictures go", len(sent) >= 5, "%d pictures" % len(sent))
    ck("each older one left out is named in its message instead", len(sent) + notes == 9, "%d sent, %d named" % (len(sent), notes))
    users = [m for m in rq["body"]["messages"] if m["role"] == "user"]
    ck("the newest photo message keeps its picture", isinstance(users[-2]["content"], list), type(users[-2]["content"]).__name__)

    print("=== 7. A PICTURE IN THE CHAT OPENS WHOLE ===")
    pg.tap(".msg.user .msg-atts img >> nth=0")
    pg.wait_for_timeout(200)
    v = pg.evaluate("(() => { const v = document.querySelector('#imgView'); if (!v) return {shown:false}; const r = v.getBoundingClientRect(); return {shown: !v.hidden, w: r.width, h: r.height, src: (v.querySelector('img').getAttribute('src')||'').slice(0, 22)}; })()")
    ck("a tap opens it over everything", v["shown"] and v.get("w") == 412 and v.get("src", "").startswith("data:image/"), v)
    if v["shown"]:
        pg.tap("#imgView")
        pg.wait_for_timeout(150)
    ck("and a tap closes it", v["shown"] and pg.evaluate("document.querySelector('#imgView').hidden"))
    ctx.close()
    br.close()

SRV.shutdown()
shutil.rmtree(D, ignore_errors=True)
print("\n" + ("FAILED %d" % failed if failed else "ALL PASS") + "  (%d checks)" % (passed + failed))
sys.exit(1 if failed else 0)
