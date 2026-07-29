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
Pick one as your main, or move everything across with **Back up** / **Restore**.

---

## Setting up a connection

Gear icon → **Add a connection**. Presets fill in the address for you:
Claude, OpenAI, OpenRouter, Z.ai, Gemini, DeepSeek, Hermes Agent. For
**NeuralWatt** or **Wafer**, choose **Custom** and paste their base URL.

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
- **Archive** — the box icon on a chat's row. Archived chats leave the list but are never out of reach: the **"N archived — tap to browse"** row (also Settings → Data → **Browse the archive**) lists every one with its date and last line, so forgetting a title loses nothing. From there: open it where it lies, put it back, or delete it. Search still reaches them too

**Attachments**
- Tap the paperclip, or just paste an image straight into the message box
- Images go to the model as images; text files are inlined as code blocks
- 6 MB per file

**Files the assistant can edit — and write**
- Tap the file icon in the top bar → **Let the assistant write files**.
- **Attach as many files as you like to one chat.** All of them are sent, each
  under its own `[FILE: name]` heading, so you can ask for a comparison, or have
  changes made across several documents in one reply.
- Ask for a document and it creates one: the reply comes with a
  **Create file — name.md** card, and approving it makes the file and attaches
  it. No need to make an empty file first.
- Or make one yourself: sidebar → **Files** → create, or import from your device.
- Changes arrive as red/green cards — **Apply**, **Skip**, or **Apply all** —
  and every applied batch can be undone (8 deep, per file).
- With several files attached, each action must name the file it changes, and
  the card shows it. An action that names no file, or names one that isn't
  attached, is **refused** — writing into the wrong document silently would be
  much worse than a failed card.
- Matching is deliberately strict: exact first, then punctuation-normalised
  (curly quotes, em dashes), then a fuzzy word-window that **only applies when the
  difference is whitespace**. If the model misquotes a single word, the edit is
  refused rather than written approximately into your file.
- Malformed JSON from the model is repaired where it's safely repairable
  (trailing commas, raw newlines inside strings) and reported plainly when it isn't.
- The file icon shows a count when more than one is attached; tap it to open,
  undo, or remove any of them individually.
- **Stale cards retire themselves.** Ask again without applying, and when the
  new reply proposes the same change — same append, same quoted find, a full
  rewrite covering it, a duplicate create — the older card is marked
  **Superseded** and drops out of Apply all. Newest wins, visibly; a stale
  card can never land an append twice or nest a replacement inside the fresh
  one. Anything not provably the same change (a rephrased quote, an insert
  next to a replace) is left alone.
- **Each version of a reply keeps its own cards.** Swiping ‹ › shows that
  version's proposals with their own applied/pending states — one version's
  prose never sits over another version's cards, and regenerating no longer
  drops the cards the old version proposed.

**Projects** (sidebar → **+ Project**)
- A project groups chats and gives them shared ground: its own **instructions**,
  an **instruction set** for new chats born inside it, and **project files** every
  chat in it can read — and the assistant can edit.
- Chats in a project sit under its own heading in the sidebar; **+** on the
  heading starts a chat there, **✎** opens the project's settings.
- Move any chat in or out under Settings → Chat → **Project**.
- Project instructions are live — edit them once, every chat in the project
  follows. The instruction set is pinned per chat at creation, the same rule
  as every other setting.
- Deleting a project never deletes anything else: its chats stay, its files stay.

**Smart context** (retrieval)
- Any file can be switched between **Full** and **Smart** in the file card —
  tap the file icon in the top bar, then the mode button on its row.
- Full sends the whole file. Smart, once a file passes 2,000 characters, sends
  only the parts relevant to your latest message: paragraph chunks scored by
  your message's rarer words, the winners kept in document order with […]
  marking the gaps.
- Excerpted files are labelled as excerpts to the model, and a **replace_all**
  against one is refused — a model that saw part of a file must not rewrite
  all of it. Switch the file to Full when you want a ground-up rewrite.

**Instruction sets** (Settings → Instructions)
- Save any number of named sets and switch between them instantly
- Each holds its own system prompt, its own blocks, **and their order**
- **Copy** a set, **Export** one to a file, **Import** one back

**Prompt order**
Everything the model receives, shown as one list in the order it receives it.
Drag by the handle, or use the arrows.

**The conversation is an item in that list.** Anything above it is sent before
the chat; anything below it is sent after, right before the reply. The main
system prompt is an item too, so it can be moved like anything else.

A block set to **In-chat** ignores the list and slots into the conversation
itself, at a depth counted back from the newest message — depth 0 sits right
before the reply, depth 4 sits four messages up. Shallow depths stay in the
model's attention; deep ones fade like older context.

Leading system-role blocks fold into the API's system parameter, in order, and
stop folding as soon as something non-system comes first — so folding can never
silently reorder what you arranged.

Blocks can be sent as System, You, or Assistant, and toggled on and off.
Settings → Chat also has an extra system box that applies to **the open chat only**.

**Saved prompts**
- Sidebar → **Prompts**, or the Prompts button under the message box
- Save what you've typed with one tap, then drop it back in whenever

**Squash system messages** (Settings → Chat, on by default)
Sends neighbouring system blocks as one message instead of several.

Say three system blocks sit next to each other. With squash on, the model
receives one system message containing all three, separated by blank lines.
With it off, it receives three separate system messages.

Most APIs follow a single system message more reliably, and one message costs
fewer delimiter tokens. Turn it off when you want each block treated as a
distinct instruction — some models weigh separate messages more literally, and
it makes the boundaries between blocks explicit.

It only affects blocks that end up adjacent. Anything separated by a user or
assistant turn is never merged.

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

**Hermes Agent** (a whole agent as your backend)

[Hermes Agent](https://hermes-agent.nousresearch.com/) exposes itself as an
OpenAI-compatible endpoint, which turns Cozy Chat into a frontend for a full
agent — terminal, files, web search, browser, memory, skills — including one
running your Claude Max subscription. Pick the **Hermes Agent** preset; the
address is already the API server's default, `http://127.0.0.1:8642/v1`, and
the key is whatever you set as `API_SERVER_KEY`.

On the Hermes side, in `~/.hermes/.env`:

```
API_SERVER_ENABLED=true
API_SERVER_KEY=pick-something
API_SERVER_CORS_ORIGINS=http://localhost:8787,http://127.0.0.1:8787
```

then `hermes gateway`. The CORS line matters: Cozy Chat calls Hermes straight
from the browser, and the two run on different ports, so Hermes must allow
Cozy's origin — `8787` is Cozy's default local port; whichever host the
address bar shows is the one that counts, so list both spellings. Change the
numbers if you changed `COZY_PORT`. This only works from
the **local** copy — a page served over https, like the github.io version,
is not allowed to call a plain-http localhost server, and the browser blocks
it before Hermes ever sees the request.

What you get in the chat:

- **Live tool activity, folded like thinking.** The log arrives as one
  collapsed line: while the agent works it shows the current call with a
  pulse, and when it settles it reads "8 tool calls · done". Tap to unfold
  the full list — and a drawer you opened stays open through repaints and
  rebuilds. Everything is kept on the message afterwards, so a reply's cost
  in actions is one tap away without eight rows of scroll. Stopping mid-tool
  marks the unfinished call *stopped* rather than leaving it spinning.
- **Reasoning control.** The same Off / Low / Medium / High switch every other
  service uses, sent in the shape the Hermes agent understands. Off sends
  nothing, so the agent's own configuration decides.
- **Session continuity, free.** Hermes recognises a conversation by its system
  prompt and first message, so every Cozy chat maps to one agent session (and
  one sandbox) with no setup.
- **Show or hide it.** Settings → Chat → *Show tool activity*. Hidden still
  records — flip it back on and past activity reappears.
- **Approvals, answered in the chat.** Turn on **Hermes runs mode** on the
  connection (edit it → *Hermes runs mode*). Sends then travel the agent's
  Runs API, and when a command needs permission a card appears right in the
  stream — the exact command, and the choices the server offers: **Allow
  once**, **This chat**, **Always allow**, **Deny**. Tap one and the run
  carries on; no terminal. Stopping the stream also stops the agent
  server-side. A card left unanswered when its run ends is marked expired,
  never left with live-looking buttons. One limit: a message carrying an
  image falls back to the plain stream for that turn (runs don't take
  images), so approvals resume on the next text message. Runs mode needs a
  Hermes build with the Runs API. **If yours doesn't have it, or the browser
  can't reach it, the message is never lost:** Cozy falls back to the plain
  stream, tells you **once ever**, stops any run it had already started, and
  stops knocking for good — across reloads too. The connection editor shows
  the state next to the Runs mode setting, and **saving the connection** is
  the deliberate act that tries the API afresh (do that after updating
  hermes-agent). If you're keeping an older server, just switch runs mode
  Off — the plain stream is what you're getting anyway, minus the note. A server that has the API and genuinely errors still errors
  loudly — the fallback only covers "this transport isn't there". To see
  which case yours is, from Termux:

  ```
  curl -i -X POST http://127.0.0.1:8642/v1/runs \
    -H "Origin: http://127.0.0.1:8787" \
    -H "Authorization: Bearer YOUR_KEY" \
    -H "Content-Type: application/json" -d '{"input":"hi"}'
  ```

  `404` means your Hermes predates the Runs API — update it. A `2xx` with a
  `run_id` means the API exists and the browser path is the problem: check
  the `Access-Control-Allow-Origin` in that reply matches Cozy's address bar
  exactly. Prefer no approvals at all? Leave runs mode off, or set
  `HERMES_YOLO_MODE=1` server-side (the hardline destructive-command
  floor still applies either way).
- **Search links.** Hermes doesn't put result URLs on the wire — the activity
  row shows *what* was searched. Links appear when the agent cites them in
  its reply, where they're tappable like any other link.
- **Session headers, opt-in.** Each connection has a *Hermes session headers*
  switch that sends `X-Hermes-Session-Id` (pinned to the chat, survives
  editing the first message) and a stable `X-Hermes-Session-Key` for long-term
  memory scoping. It's off by default because the stock server's browser
  allow-list rejects those headers in preflight — turn it on only if your
  Hermes build allows them, or you route through a relay that does.

**Image results** (Settings → Search → *Show image results*, on by default)
- Search comes back with pictures where the provider has them: a strip of
  tappable thumbnails under your message, each opening its source. "What do
  Bleach characters look like" gets faces, not just prose.
- Tavily includes images free on the same request. Serper spends one extra
  credit per search on its images endpoint — and if that call fails, the text
  results land anyway. Exa reuses each page's own image. Claude's native
  search doesn't return images.
- The model is told exactly which pictures you're already looking at, so it
  can talk about "the images above" instead of guessing.
- **Asking for a picture fetches pictures.** "Give me an image of X", "pics
  of Y", "what does Z look like" — phrasings like these run the image search
  by themselves, no magnifier tap. Needs Search switched on with a provider
  key (Tavily's free tier is enough); turn the reflex off under Settings →
  Search if you'd rather arm it by hand.
- Markdown image syntax now renders too — any model that writes
  `![name](https://…)` shows the picture inline, linked to its source.
- **A leaked `MEDIA:` tag explains itself.** An older hermes-agent prints
  `MEDIA:/tmp/….png` as raw text instead of inlining the image — Cozy turns
  that into a plain note naming the file and the cure (update hermes-agent).
  For instant pictures of well-known things, the magnifier's image search is
  one call; the agent hunting them down is twenty.
- **Hermes' own images render as well.** When the agent downloads or
  *generates* an image, its server inlines the actual bytes as a data-URL
  markdown image (up to 5 MB) — Cozy shows it in the reply. For internet
  pictures, tell the agent once, in the connection's instruction set:
  *"When the user asks what something looks like, include direct image URLs
  as markdown images: `![name](https://…)` — but only URLs that appear in
  your search results or that you fetched and verified. Never construct an
  image URL from memory: a guessed URL shows a logo or the wrong picture."* Some sites refuse hotlinking — the picture's link still opens
  the source either way.

**Look**
Six themes: Hearth, Parchment, Cyber, Normandy, Terminal, Dusk.
Settings → App, or tap the moon icon to cycle.

**Data**
- Ember bar above the message box fills as the context window fills
- Backup and restore everything — conversations, settings, and your files — to a JSON file
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
| `ensureOrder()` | Builds and repairs the prompt order, migrating old positions |
| `orderMove()` / `orderMoveTo()` | Pure reorder helpers — arrows and drag both call these |
| `splitReasoning()` | Pulls `<think>` blocks out of replies |
| `assembleMessages()` | System prompt + depth blocks + file + attachments → final message list |
| `DOCEDIT_PROTOCOL` | What the assistant is told about editing files |
| `locate()` | Three-tier text matching for file edits |
| `applyEditToText()` | Applies one approved edit |
| `reasonStyle()` / `applyReasoning()` | Which thinking parameter each service wants |
| `loadModels()` | Fetches the model dropdown from `/models` |
| `connLabel()` | Shows the model once instead of connection name + model |
| `runSearch()` | Web search calls per service |
| `toolLogHtml()` | The agent tool-activity log on a message |
| `renderMarkdown()` | Markdown → HTML |
| `send()` | Sends and reads the streaming reply |
| `on()` | Safe event binding — a missing element warns instead of breaking the app |

**Tests.** Everything in `tests/` — `v59test.js` down to `v2test.js`, plus
`domtest.js`, `migtest.js`, `negtest.js`, `csstest.js`, `swtest.js`,
`scrolltest.js`, `styletest.js`, `hiddentest.js`, `coherencetest.js` and
`installtest.sh` — runs under Node with jsdom (`npm i jsdom fake-indexeddb`).
902 checks across the matching engine, JSON tolerance, prompt assembly,
proposal supersede,
projects, retrieval, streaming, SSE framing and Hermes tool activity,
stream/chat binding, touch reorder, reader-owned scrolling, backup
round-trips, migration, and negative tests that deliberately reintroduce
fixed bugs to prove the guards fire.

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

`cozy` prints what it did — `Updated 4.0.2 -> 4.1.0` or `Already on 4.1.0` —
so you never have to guess whether an update landed.

The local copy is served by `serve.py`, which forbids caching. Plain
`python -m http.server` answers conditional requests with 304, which lets a
browser keep showing files you have already replaced: the update pulls fine and
the screen changes nothing.

The server is detached, so it keeps running when you close Termux. Change the
port with `COZY_PORT=8788 cozy` if something else is using 8787 — it tells you
when that happens rather than failing quietly.

`cozy` also updates itself: if a release ships a newer launcher, it reinstalls
the command and carries on. You only ever run the install line once.

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

Conversations and files live in IndexedDB, settings and keys in localStorage. Nothing is
uploaded anywhere — requests go straight from your phone to whichever service
you connected.

Clearing Chrome's site data wipes it, so use **Back up** now and then — one
file carrying every chat, file, and setting.
