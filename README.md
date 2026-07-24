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

**Finding things**
- **Search every chat** — matches message contents, not just titles, with the hit highlighted
- **Pin** a chat: long-press its title (or right-click it in the list)
- Archived chats stay out of the list but still turn up in search

**Attachments**
- Tap the paperclip, or just paste an image straight into the message box
- Images go to the model as images; text files are inlined as code blocks
- 6 MB per file

**Files the assistant can edit**
- Sidebar → **Files**. Create one, or import from your device.
- An attached file shows as a single icon in the top bar — no extra row on
  screen. Tap it for Open / Undo / Stop using it here.
- Attach a file to a chat and the assistant can change it directly. It proposes
  edits as red/green cards — **Apply**, **Skip**, or **Apply all**.
- Every applied batch goes on an undo stack (last 8), so **Undo** is one tap.
- Matching is deliberately strict: exact first, then punctuation-normalised
  (curly quotes, em dashes), then a fuzzy word-window that **only applies when the
  difference is whitespace**. If the model misquotes a single word, the edit is
  refused rather than written approximately into your file.
- Malformed JSON from the model is repaired where it's safely repairable
  (trailing commas, raw newlines inside strings) and reported plainly when it isn't.
- Open, save, rename, export, or copy the file at any time.

**Instruction sets** (Settings → Instructions)
- Save any number of named sets and switch between them instantly
- Each holds its own system prompt and its own instruction blocks
- **Copy** an existing set, **Export** one to a file, **Import** one back
- Each block can sit at:
  - **Very top** — before the conversation
  - **At depth N** — counts back from the newest message. Depth 0 sits right
    before the reply (strongest); depth 4 sits four messages up
  - **Very bottom** — after everything
- Blocks can be sent as System, You, or Assistant, and toggled on/off
- Settings → Chat also has an extra system box that applies to **the open chat only**

**Saved prompts**
- Sidebar → **Prompts**, or the Prompts button under the message box
- Save what you've typed with one tap, then drop it back in whenever

**Thinking**
- Shown in a collapsible block
- Handles models with a separate reasoning field *and* models that write
  `<think>…</think>` inline. The tags never leak into the reply text.
- **Effort** — Settings → Chat: Off / Low / Medium / High.
  Every service spells this differently, so the app sends the right shape for
  each one and works it out from your connection and model name:

| Service | What gets sent |
|---|---|
| Claude 4.6+ | `thinking: {type:"adaptive"}` + `output_config.effort` |
| Claude 4.6 and older | `thinking: {type:"enabled", budget_tokens}` |
| OpenAI | `reasoning_effort` |
| GLM / Z.ai | `thinking: {type:"enabled"}`, plus `reasoning_effort` above Low |
| Qwen | `enable_thinking` |
| OpenRouter | `reasoning: {effort}` |
| DeepSeek | nothing — the reasoner model decides for itself |

  A GLM model on a custom endpoint is detected from the model name, so
  NeuralWatt and Wafer get the GLM shape automatically. There's an override on
  each connection if a service needs something else.

**Picking a model**
- **Load list** next to the Model field pulls the service's `/models` and turns
  it into a dropdown. The list is saved with the connection.
- If a service doesn't offer that endpoint, nothing breaks — type the name as before.

**Web search**
- Off by default. Turn it on in Settings → Search and a magnifier appears next to
  the message box — tap for one message, or set it to search everything.

| Service | Free allowance | Notes |
|---|---|---|
| Claude's own search | none — $10 per 1,000 | No extra key. Claude connections only. |
| **Tavily** | **1,000/month, no card** | Returns page text. Best free pick. |
| Exa | 1,000/month | Meaning-based, includes contents |
| Serper | 2,500 to start | Google results, cheap after |
| Brave | $5 credit/month, card required | Free tier ended Feb 2026. Needs a relay. |

Google's Programmable Search (the one TypingMind used) is closed to new signups
and shuts down 1 Jan 2027, so it isn't offered here.

**Look**
Six themes: Hearth, Parchment, Cyber, Normandy, Terminal, Dusk.
Settings → App, or tap the moon icon to cycle.

**Data**
- Ember bar above the message box fills as the context window fills
- Backup and restore everything to a JSON file
- Save any conversation as Markdown

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
| `PS()` | The active instruction set — all prompt reads go through it |
| `splitReasoning()` | Pulls `<think>` blocks out of replies |
| `assembleMessages()` | System prompt + depth blocks + file + attachments → final message list |
| `DOCEDIT_PROTOCOL` | What the assistant is told about editing files |
| `locate()` | Three-tier text matching for file edits |
| `applyEditToText()` | Applies one approved edit |
| `reasonStyle()` / `applyReasoning()` | Which thinking parameter each service wants |
| `loadModels()` | Fetches the model dropdown from `/models` |
| `connLabel()` | Shows the model once instead of connection name + model |
| `runSearch()` | Web search calls per service |
| `renderMarkdown()` | Markdown → HTML |
| `send()` | Sends and reads the streaming reply |
| `on()` | Safe event binding — a missing element warns instead of breaking the app |

**Tests.** `v32test.js`, `v31test.js`, `v3test.js`, `v2test.js`, `domtest.js`, `migtest.js` and
`negtest.js` and `csstest.js` run under Node with jsdom (`npm i jsdom fake-indexeddb`). 269 checks across the
matching engine, JSON tolerance, prompt assembly, streaming, migration, and a
negative test that deliberately reintroduces a fixed bug to prove the guard fires.

---

## Running it on your phone (Termux)

One command installs it, and re-running the same command is how you update:

```
curl -fsSL https://raw.githubusercontent.com/brucestarkallen/Cozy-Chat-Frontend/main/install.sh | bash
```

That sets up a `cozy` command:

| | |
|---|---|
| `cozy` | update, start the server, open it |
| `cozy status` | running? which version? |
| `cozy stop` | stop the server |
| `cozy restart` | restart it |
| `cozy update` | pull the latest without restarting |
| `cozy log` | recent server output |
| `cozy path` | where the files live |

The server is detached, so it keeps running when you close Termux. Change the
port with `COZY_PORT=8788 cozy` if something else is using 8787 — it tells you
when that happens rather than failing quietly.

**Your chats won't follow you here.** Browsers keep storage separate per
address, so the local copy starts empty even if you have conversations on the
github.io version. Open the old one, **Back up**, then open the local one and
**Restore**.

---

## Bonus: the same reading layout in SillyTavern

`sillytavern-immersive.css` strips SillyTavern's chat down to the same shape as
this app — no avatar column, no bubble around every message, no timestamps or
ID badges, names reduced to a small quiet label.

Paste it into **User Settings → Custom CSS**. It applies immediately; nothing
is installed and nothing is permanent — clear the box to go back.

Written against SillyTavern's actual `#message_template`, and tested with that
markup under a competing theme to confirm each override wins (`csstest.js`,
41 checks).

Ten numbered blocks, each independent — delete any one you don't want. At the
bottom there are commented-out extras: hide names entirely, serif body text,
wider measure for landscape, dim everything except the newest message, and
fade the top icon row until you reach for it.

---

## Your data

Conversations live in IndexedDB, settings and keys in localStorage. Nothing is
uploaded anywhere — requests go straight from your phone to whichever service
you connected.

Clearing Chrome's site data wipes it, so use **Back up** now and then.
