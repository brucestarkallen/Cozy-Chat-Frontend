# Cozy Chat

A private AI chat client. One HTML file, no build step, no server.
Your keys and conversations stay on your device.

---

## Two ways to run it

### On the web (default)

Already switched on. Open:

```
https://brucestarkallen.github.io/Cozy-Chat-Frontend/
```

In Chrome: menu (⋮) → **Add to Home screen**. Opens fullscreen like a real app.

### Locally from Termux

```bash
pkg install git python
git clone https://github.com/brucestarkallen/Cozy-Chat-Frontend
cd Cozy-Chat-Frontend
bash serve.sh
```

Then open `http://localhost:8080` in Chrome. That's it — no build, no npm,
no waiting. Edit `index.html` in Termux, refresh the tab, changes are live.

**One thing to know:** the web version and the local version are treated as two
different sites by Chrome, so they keep **separate** conversation histories.
Pick one as your main, or move chats across with **Back up** / **Restore**.

---

## Setting up a connection

Gear icon → **Add a connection**. Presets fill in the address for you:
Claude, OpenAI, OpenRouter, Z.ai, Gemini, DeepSeek. For **NeuralWatt** or
**Wafer**, choose **Custom** and paste their base URL.

Tap **Test** before saving.

---

## Features

**Chat**
- Several connections saved at once, switch anytime
- Streaming replies with a stop button
- **Swipe** — regenerate without losing the old answer; arrows move between versions
- **More** — make the model continue where it stopped instead of restarting
- **Branch** — fork any point of a chat into a new conversation
- Edit any message and re-run from there
- Copy, delete, retry per message
- Markdown, tables, code blocks with copy buttons

**Thinking**
- Reasoning shows in a collapsible block
- Handles models that use a separate reasoning field *and* models that write
  `<think>…</think>` inline in the reply. The tags never leak into the text.
- Editable tag list under Settings → Chat if your model uses something else

**Instructions** (Settings → Instructions)
- A main system prompt that always sits at the top
- Plus any number of extra instruction blocks you can place anywhere:
  - **Very top** — before the conversation, next to the system prompt
  - **At depth N** — counts back from the newest message. Depth 0 sits right
    before the reply (strongest); depth 4 sits four messages up
  - **Very bottom** — after everything
- Each block can be sent as System, You, or Assistant, and toggled on/off

**Web search**
- Off by default. Turn it on in Settings → Search, then a magnifier appears
  next to the message box. Tap it to search on the next message only, or set
  it to search every message.
- Sources appear as a collapsible list under the reply.

| Service | Free allowance | Notes |
|---|---|---|
| Claude's own search | none, billed per search | No extra key. Claude only. |
| Tavily | 1,000/month, no card | Returns page text. Best free pick. |
| Exa | 1,000/month | Meaning-based, includes contents |
| Serper | 2,500 to start | Google results, cheap after |
| Brave | $5 credit/month, card required | Free tier ended Feb 2026. Needs a relay. |

Google's Programmable Search (the one TypingMind used) is closed to new
signups and shuts down 1 Jan 2027, so it isn't offered here.

**Look**
Six themes: Hearth, Parchment, Cyber, Normandy, Terminal, Dusk.
Settings → App, or tap the moon icon to cycle.

**Data**
- Ember bar above the message box fills as the context window fills
- Backup and restore everything to a JSON file
- Save any conversation as Markdown

---

## If a connection won't connect

Some services refuse calls that come straight from a browser. If the address is
right and you're online but it still fails, that's why.

Fix: put a relay address in that connection's **Relay address** field. A
Cloudflare Worker on the free plan does it:

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    const res = await fetch("https://YOUR-PROVIDER-BASE-URL" + url.pathname + url.search, {
      method: req.method, headers: req.headers, body: req.body, duplex: "half"
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

Anthropic, OpenAI, OpenRouter, Gemini and DeepSeek all work without one.
Search services have their own separate relay field under Settings → Search.

---

## Changing things

Everything is in `index.html`. Edit, push, refresh. The service worker is
network-first, so a refresh always gets the newest version.

| Section | What it does |
|---|---|
| `:root[data-theme=…]` | Every theme's colours — copy a block to add your own |
| `THEMES` | Registers a theme in the picker |
| `PRESETS` | The service dropdown |
| `splitReasoning()` | Pulls `<think>` blocks out of replies |
| `assembleMessages()` | System prompt + depth injections → final message list |
| `runSearch()` | Web search calls per service |
| `renderMarkdown()` | Markdown → HTML |
| `send()` | Sends and reads the streaming reply |
| `updateEmber()` | The context bar |

---

## Your data

Conversations live in IndexedDB, settings and keys in localStorage. Nothing is
uploaded anywhere — requests go straight from your phone to whichever service
you connected.

Clearing Chrome's site data wipes it, so use **Back up** now and then.
