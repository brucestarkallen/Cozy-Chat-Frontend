# Cozy Chat

A private AI chat client. One HTML file, no build step, no server. Your keys and
conversations stay on your device.

---

## Turn it on

**1. Switch on hosting** (one time only)

In this repo: **Settings → Pages → Source: "Deploy from a branch" → Branch: `main` / `(root)` → Save.**

Wait about a minute, then open:

```
https://brucestarkallen.github.io/Cozy-Chat-Frontend/
```

**2. Make it an app**

Open that link in Chrome → menu (⋮) → **Add to Home screen**. It now opens
fullscreen with no browser bars, like a normal app.

**3. Add a connection**

Tap the gear icon → **Add a connection**:

| Field | What goes in it |
|---|---|
| Service | Pick one, or **Custom** for anything OpenAI-compatible |
| Address | Filled in for you on presets; for Custom, the endpoint's base URL |
| API key | Your key |
| Model | The exact model name the service expects |
| Context window | Sets the scale of the ember bar |

Tap **Test** to check it before saving.

For **NeuralWatt** or **Wafer**, choose **Custom** and paste their base URL.

---

## What's in it

- Multiple saved connections, switch between them anytime
- Streaming replies, stop mid-answer
- Thinking/reasoning shown in a collapsible block
- Edit any message and re-run from that point
- Retry, copy, delete individual messages
- Markdown with code blocks and copy buttons
- **Ember bar** — the strip above the message box fills as the context window
  fills, and glows when it's getting full
- Backup and restore everything to a JSON file
- Save any conversation as Markdown
- Warm dark and warm light themes
- Works offline for reading old chats

---

## If a connection won't connect

Some services refuse calls that come straight from a browser. If the address is
right and you're online but it still fails, that's the reason.

Fix: put a relay address in the connection's **Relay address** field. A
Cloudflare Worker on the free plan does the job:

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }
    const target = "https://YOUR-PROVIDER-BASE-URL" + url.pathname;
    const res = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      duplex: "half"
    });
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors())) out.headers.set(k, v);
    return out;
  }
};
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST,GET,OPTIONS"
  };
}
```

Anthropic, OpenAI, OpenRouter, Gemini and DeepSeek all work without a relay.

---

## Changing things

Everything is in `index.html`. Edit it, push, pull up the app, refresh.
The service worker is network-first, so a refresh always gets the newest version.

Rough map of the file:

| Section | What it does |
|---|---|
| `:root[data-theme=...]` | All colours |
| `PRESETS` | The service dropdown |
| `renderMarkdown()` | Markdown → HTML |
| `buildPayload()` | Shapes the API request |
| `send()` | Sends and reads the streaming reply |
| `updateEmber()` | The context bar |

---

## Your data

Conversations live in your browser's IndexedDB. Settings and keys live in
localStorage. Nothing is uploaded anywhere — requests go straight from your
phone to whichever service you connected.

Clearing Chrome's site data wipes it all, so use **Back up** now and then.
