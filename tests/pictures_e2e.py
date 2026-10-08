# TEST FILE - run with: python3 tests/pictures_e2e.py [checkout]
# Pictures for a vision model, measured in real Chromium (jsdom cannot decode
# a picture or draw one): what reaches the model from a sideways phone photo
# with GPS in it, a 48 MP photo, a screenshot, a see-through sticker, a picture
# sent on its own (OpenAI and Claude wires), a chat full of pictures and what
# it costs to draw, pictures stored by older versions, and a Claude request of
# more than 20 pictures.
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
# v5.28.8 prepared a photo to 2048 px on its long edge, upright, clean
photo_like(1536, 2048, 40).save(os.path.join(D, "v5288.jpg"), "JPEG", quality=88)
# wide flat pictures: prepared to 2000 x 667, a few KB each, so many fit a request
for i in range(22):
    im = Image.new("RGB", (3000, 1000), (20 + i * 9, 120, 200 - i * 7))
    ImageDraw.Draw(im).rectangle([100 + i * 50, 100, 400 + i * 50, 600], fill=(250, 250, 250))
    im.save(os.path.join(D, "wide%02d.png" % i), "PNG")
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
    ck("at most 2000 px on its long edge", max(w, h) == 2000, im.size)
    ck("as a JPEG", mime == "image/jpeg" and im.format == "JPEG", mime)
    ck("with no orientation flag left to misread", ex.get(0x0112) in (None, 1), ex.get(0x0112))
    ck("and without the place it was taken", not ex.get_ifd(0x8825), dict(ex.get_ifd(0x8825)))
    ck("several times smaller than the camera's file", len(base64.b64decode(data)) * 3 < PHOTO_BYTES,
       "%d bytes, the camera's %d" % (len(base64.b64decode(data)), PHOTO_BYTES))
    att = pg.evaluate("(() => { const a = current.messages[0].attachments[0]; return {w:a.w, h:a.h, thumb:(a.thumb||'').slice(0, 23), thumbLen:(a.thumb||'').length}; })()")
    ck("the chat keeps its size", att["w"] == w and att["h"] == h, att)
    th = pg.evaluate("(() => { const i = document.querySelector('.msg.user .msg-atts img'); return i ? {w:i.naturalWidth, h:i.naturalHeight, src:i.getAttribute('src').slice(0, 23)} : null; })()")
    ck("and the thread draws a small copy of it, not the picture", th and th["src"] == "data:image/webp;base64," and max(th["w"], th["h"]) == 480,
       th)

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
    ck("scaled to 2000 px tall with its shape kept", i1.size == (900, 2000), i1.size)
    ck("the sticker stays PNG", m2 == "image/png", m2)
    ck("and stays see-through", i2.convert("RGBA").getpixel((2, 2))[3] == 0 and i2.convert("RGBA").getpixel((256, 256))[3] == 255,
       (i2.convert("RGBA").getpixel((2, 2)), i2.convert("RGBA").getpixel((256, 256))))
    corner = pg.evaluate("""(async () => { const a = current.messages[current.messages.length - 2].attachments[1];
      if (!a.thumb) return null;
      const im = new Image(); im.src = a.thumb; await im.decode(); const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
      const x = cv.getContext('2d'); x.drawImage(im, 0, 0); return Array.from(x.getImageData(1, 1, 1, 1).data); })()""")
    ck("its small copy in the thread is see-through too", bool(corner) and corner[3] == 0, corner)

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
    # drawing it: the thread carries small copies, not nine whole photos
    html_len = pg.evaluate("document.querySelector('#threadInner').innerHTML.length")
    ck("the drawn thread holds small copies, not the photos", html_len < 600_000, "%d characters of HTML" % html_len)
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})            # a phone's CPU
    ms = pg.evaluate("""(async () => { const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const pics = current, t = []; for (let k = 0; k < 5; k++){ const s = performance.now(); renderThread(); document.body.offsetHeight; await frame(); t.push(performance.now() - s); }
      t.sort((a, b) => a - b); return t[2]; })()""")
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    ck("and redraws on a phone-speed CPU in well under half a second", ms < 400, "%.0f ms" % ms)

    print("=== 7. A PICTURE IN THE CHAT OPENS WHOLE ===")
    pg.tap(".msg.user .msg-atts img >> nth=1")                       # the first photo of the nine
    pg.wait_for_timeout(200)
    # the picture's real size, read from its own bytes
    whole = pg.evaluate("""(async () => { const i = document.querySelectorAll('.msg.user .msg-atts img')[1];
      const m = current.messages.find(x => x.id === i.closest('[data-mid]').getAttribute('data-mid'));
      const a = m.attachments.filter(x => x.kind === 'image')[0], im = new Image();
      im.src = 'data:' + a.mime + ';base64,' + a.data; await im.decode();
      return [im.naturalWidth, im.naturalHeight, i.naturalWidth, i.naturalHeight]; })()""")
    v = pg.evaluate("""(async () => { const v = document.querySelector('#imgView'); if (!v) return {shown:false}; const r = v.getBoundingClientRect(); const i = v.querySelector('img');
      try { await i.decode(); } catch(_){} return {shown: !v.hidden, w: r.width, h: r.height, src: (i.getAttribute('src')||'').slice(0, 22), nw: i.naturalWidth, nh: i.naturalHeight}; })()""")
    ck("a tap opens it over everything", v["shown"] and v.get("w") == 412 and v.get("src", "").startswith("data:image/"), v)
    ck("as the whole picture, not the small copy the thread drew", (v.get("nw"), v.get("nh")) == (whole[0], whole[1]) and whole[2] < whole[0],
       "viewer %sx%s, picture %sx%s, thread copy %sx%s" % (v.get("nw"), v.get("nh"), whole[0], whole[1], whole[2], whole[3]))
    if v["shown"]:
        pg.tap("#imgView")
        pg.wait_for_timeout(150)
    ck("and a tap closes it", v["shown"] and pg.evaluate("document.querySelector('#imgView').hidden"))
    ctx.close()

    print("=== 8. PICTURES STORED BY OLDER VERSIONS ARE MADE READY ===")
    ctx, pg = page_for("anthropic")
    b64 = lambda n: base64.b64encode(open(os.path.join(D, n), "rb").read()).decode()
    pg.evaluate("""([raw, v5288, heic]) => { newConvo(); current.messages.push(
        {id:'u0', role:'user', content:'from v5.28.7', attachments:[{kind:'image', name:'camera.jpg', mime:'image/jpeg', data:raw}]},
        {id:'a0', role:'assistant', content:'a red band'},
        {id:'u1', role:'user', content:'from v5.28.8', attachments:[{kind:'image', name:'v5288.jpg', mime:'image/jpeg', data:v5288}]},
        {id:'a1', role:'assistant', content:'a gradient'},
        {id:'u2', role:'user', content:'from an iPhone', attachments:[{kind:'image', name:'iphone.heic', mime:'image/heic', data:heic}]},
        {id:'a2', role:'assistant', content:'?'}); renderThread(); }""", [b64("photo.jpg"), b64("v5288.jpg"), b64("notapicture.heic")])
    _, rq = send(pg, "What do all of these show?")
    sent = pictures(rq["body"])
    ims = []
    for m, d in sent:
        try:
            ims.append(opened(m, d))
        except Exception:
            ims.append((Image.new("RGB", (1, 1)), Image.Exif()))      # bytes no picture reader can open
    ck("the camera's photo and the v5.28.8 one both go", len(sent) == 2, len(sent))
    ck("the camera's photo now goes upright, 2000 px, without its GPS position",
       len(ims) == 2 and ims[0][0].size == (1500, 2000) and ims[0][0].convert("RGB").getpixel((750, 60)) == (220, 20, 20) and not ims[0][1].get_ifd(0x8825),
       ims and (ims[0][0].size, ims[0][0].convert("RGB").getpixel((750, 60)), dict(ims[0][1].get_ifd(0x8825))))
    ck("the v5.28.8 one is brought to 2000 px", len(ims) == 2 and max(ims[1][0].size) == 2000, ims and ims[1][0].size)
    heic = [m for m in rq["body"]["messages"] if m["role"] == "user" and "iphone.heic" in json.dumps(m["content"])]
    ck("the one Chrome cannot open is named, not sent to Claude (it takes JPEG, PNG, GIF, WebP)",
       heic and "JPEG, PNG, GIF and WebP" in json.dumps(heic[0]["content"]) and not isinstance(heic[0]["content"], list),
       heic and json.dumps(heic[0]["content"])[:160])
    kept = pg.evaluate("current.messages.filter(m => m.attachments).map(m => { const a = m.attachments[0]; return {w:a.w||0, h:a.h||0, thumb:!!a.thumb, raw:!!a.raw, chars:a.data.length}; })")
    ck("the chat keeps the ready pictures, with small copies", kept[0]["w"] == 1500 and kept[0]["thumb"] and kept[1]["w"] == 1500 and kept[1]["thumb"], kept)
    ck("and marks the one it could not open, so it is not tried again", kept[2]["raw"] and not kept[2]["thumb"], kept[2])
    ck("it said what it was doing", pg.evaluate("window.__toasts.some(t => /Getting 3 older pictures ready/.test(t))"), pg.evaluate("window.__toasts.slice(-3)"))
    n_toasts = pg.evaluate("window.__toasts.filter(t => /older picture/.test(t)).length")
    send(pg, "And now?")
    ck("the next message does not do it again", pg.evaluate("window.__toasts.filter(t => /older picture/.test(t)).length") == n_toasts)
    ctx.close()
    # OpenAI and OpenRouter take the same four kinds, and refuse a request over any other
    ctx, pg = page_for("openai")
    pg.evaluate("""([heic]) => { newConvo(); current.messages.push(
        {id:'u0', role:'user', content:'from an iPhone', attachments:[{kind:'image', name:'iphone.heic', mime:'image/heic', data:heic}]},
        {id:'a0', role:'assistant', content:'?'}); renderThread(); }""", [b64("notapicture.heic")])
    _, rq = send(pg, "And this?")
    ck("an OpenAI-compatible service is not sent it either, and is told of it",
       rq and not pictures(rq["body"]) and "iphone.heic" in json.dumps(rq["body"]["messages"]) and "JPEG, PNG, GIF and WebP" in json.dumps(rq["body"]["messages"]),
       rq and [m for m, d in pictures(rq["body"])])
    ctx.close()

    print("=== 9. MORE THAN 20 PICTURES IN ONE CLAUDE REQUEST ===")
    # Claude refuses any picture past 2000 px on a side in a request of more than 20
    ctx, pg = page_for("anthropic")
    names = ["wide%02d.png" % i for i in range(22)]
    attach(pg, *names)
    _, rq = send(pg, "Compare all of these")
    sizes = [opened(m, d)[0].size for m, d in pictures(rq["body"])]
    ck("all 22 go in one request", len(sizes) == 22, len(sizes))
    ck("and every one is at most 2000 px on each side", sizes and all(max(sz) <= 2000 for sz in sizes), sorted(set(sizes)))
    ctx.close()
    br.close()

SRV.shutdown()
shutil.rmtree(D, ignore_errors=True)
print("\n" + ("FAILED %d" % failed if failed else "ALL PASS") + "  (%d checks)" % (passed + failed))
sys.exit(1 if failed else 0)
