# Working on Cozy Chat

Single-file PWA: all app code lives in `index.html`. `sw.js` is the service
worker, `install.sh` the Termux installer, `tests/` the gate.

## Gate — run before every push

    npm i jsdom fake-indexeddb        # once per workspace
    for t in tests/*.js; do
      case "$t" in tests/prefillnegtest.js|tests/searchnegtest.js) continue;; esac
      node "$t" || exit 1
    done
    bash tests/installtest.sh
    python3 tests/device_e2e.py       # real Chromium + the real serve.py
    python3 tests/thinking_e2e.py     # real Chromium + a real stream: the thinking box
    python3 tests/pictures_e2e.py     # real Chromium: what a vision model receives (needs pillow)

1978 checks as of v5.28.9, plus 57 in `tests/device_e2e.py`, 24 in `tests/thinking_e2e.py`, 43 in `tests/pictures_e2e.py` and 12 in `tests/hermesmodeltest.sh` (needs a Hermes install), measured from real output: each file's own count line ("(N checks)" or "N passed", else its `ok` lines), plus `installtest.sh`'s `ok` lines.

`tests/inerttest.js` is in the loop but prints SKIP without a second checkout
to compare against. It answers the question a passing gate does not: whether a
new feature changed the request Cozy was already sending. Run it against the
previous release after anything that touches prompt assembly, `buildPayload()`
or `applyReasoning()`:

    git worktree add /tmp/cozy-prev <the commit before your work>
    OLD=/tmp/cozy-prev node tests/inerttest.js

Compare against the commit your work sits on, not an older favourite. Cozy has
more than one session pushing to it, and a baseline several releases back
reports somebody else's deliberate change as a difference in yours — which
reads like a regression and is not one.

`tests/searchnegtest.js` is held out for the same reason as the one below it:
it runs the search gate twelve times over. `node tests/searchnegtest.js`, or
`node tests/searchnegtest.js 0 4` for a slice. It keeps the same `.negbak`
bargain.

`tests/prefillnegtest.js` is held out of that loop because it is a *meta*
gate: it runs a prefill gate once per mutation against a mutated `index.html`,
plus a control run of each, and
takes over ten minutes. Run it on its own after touching a prefill guard, in
slices if a session cannot hold a long call:

    node tests/prefillnegtest.js          # all 42
    node tests/prefillnegtest.js 0 9      # a slice

It edits `index.html` in place. A `.negbak` is written before the first
mutation and restored at startup if a previous run was killed — without that,
an interrupted run leaves the bug in the tree looking like code somebody
wrote, and the next gate failure reads as a real defect.

Each mutation finds its line by exact text, so an edit to a line one of these
gates names silently retires that mutation (it reports "anchor appears 0
times"). Being held out of the loop, nobody saw two go stale in v5.27.0 (one
per gate) until v5.28.4; v5.28.4 itself broke two more and fixed all four.
After changing a line, grep both negtests for it — or run them, each on its
own checkout (`git worktree add`), never in the tree another gate is reading.

`tests/installtest.sh` exits 1 when a check fails. Before v5.28.4 it printed
"FAILURES PRESENT" and exited 0, so the gate loop could never have stopped on it.
It exports `COZY_DIR` for its sandbox, which hid that the README's one-line
install (no `COZY_DIR`) died at the installer's last step under `set -u` -
"COZY_DIR: unbound variable", hermesmodel never installed - from v5.28.1 until
v5.28.5. It now also runs that install exactly as the README gives it. Inside
`install.sh` the app folder is `$DIR`; `$COZY_DIR` is only an optional input.

**`serve.sh` runs `serve.py`** (v5.28.7). It ran `python -m http.server`, so
the README's "Locally from Termux" steps kept every chat in the browser and let
it keep stale copies of the app - the two things `serve.py` exists to stop.
`installtest.sh` starts it and checks the phone store answers.

**A reader of a line must follow its writer.** v5.28.2 replaced hermesmodel's
`NOMODELS <why>` line with `KEY ok|bad|none <why>` and left the menu reading
`NOMODELS`, so every provider that listed no models said "didn't list its
models ()" until v5.28.5. When a producer's output changes, grep for every
consumer of the old shape. `installtest.sh` runs hermesmodel against a
stand-in Hermes (a `hermes` whose shebang is python3, an empty HERMES_HOME).

**A blank answer to "name it" is no answer** (v5.28.5): new instruction set,
renamed set, saved prompt, renamed chat - each keeps what it had. A block or
prompt that vanished since its list was drawn (another browser) redraws the
list instead of throwing, and a block with no name gets `""`, never shows
"undefined".

**Check reads a file as JSON by its name or by a start only JSON has** (a
brace, or a bracket opening a value). v5.28.5 and earlier took any text
starting with `[` for JSON, so a note opening with a markdown link was
reported as broken JSON. A worldbook kept in a `.txt` file is still found.

Every file must exit 0. Measure check counts from real output — never predict
them, never inherit them from docs. `README.md` states the current total; if
your measurement disagrees, your measurement wins and the README gets fixed.

Never pipe a gate through `tail`, `head`, or anything else that masks the exit
code.

## Discipline

- **Root cause only.** No symptom patches. When a test fails, state whether
  the TEST or the CODE was wrong before touching either.
- **Edits** are Python exact-string replacement with a `count==1` assertion
  per replace. Audit the full `git diff HEAD` hunk-by-hunk before committing.
- **Every new guard is negative-tested**: reintroduce the bug, watch the gate
  fail, restore. **Destructive verification that restores via `git checkout`
  or `git reset` requires the baseline to be committed locally first** — a
  checkout against uncommitted work restores HEAD and destroys the work.
- **Fetch before push.** Unrecognized coherent changes in the tree are a
  concurrent instance's in-flight work: audit them, never revert them.

## Where the data lives

Served by `serve.py`, the phone is the only home: `~/.cozychat`
(`COZY_DATA_DIR`). The page learns it from `<meta name="cozy-store">`, which
only serve.py injects — no tag, no store request, and github.io keeps
IndexedDB + localStorage exactly as before. A page carrying the old
`cozy-vault` tag was served by an older server: it runs on browser storage,
says so in Settings, and the next device-mode open imports what it kept.

- **Every record has a revision.** A write names the one it was made from
  (`X-Cozy-Base`); the phone answers 409 with what it holds when that is not
  the current one, 410 when the record was deleted meanwhile. Never write
  without a base and never force one — `settle()` is the only way past a 409.
- **`settle()` never drops a side.** Settings merge three-way against the last
  revision this tab saw (`settingsBase`), lists of things with ids thing by
  thing. A chat combines when one side's messages are the other's carried
  further (`mergeChat`); otherwise this tab's chat — the live object, renamed
  and re-numbered — becomes "(this browser's copy)" and the phone's version
  comes in beside it, so a reply still streaming lands in the copy with the
  message it answers. A newer queued save of the old id is dropped at that
  moment: it is the copy's now. (Leaving it queued wrote the stale tab's
  messages over the phone's chat — caught by `device_e2e.py` §5.)
- **Remote changes apply in place** (`applyChat`, `adoptInPlace`), so
  `current` and a running `send()` keep their objects, and a `pending` message
  is never overwritten or dropped by them.
- **A write the phone cannot take** waits in the `cozychat-journal`
  IndexedDB and is replayed at the next open through the same merge rules.
  That journal is the only data a device-mode browser ever holds, and only
  while the server is away.
- **Legacy browser data** (IndexedDB `cozychat` + `cozychat:settings`) is
  imported once per browser and erased only after the manifest shows every
  record on the phone.
- **Nothing on the phone is destroyed by a request.** Delete, clear and
  restore move records to `trash/`, kept 30 days (dated by when they were
  thrown away).
- **`unstick()`** settles a reply saved mid-stream at open — never in a chat
  touched in the last 30 minutes, because another tab may still be streaming
  into it.
- **The launcher asks the server which code it runs** (`/api/version`) and
  relights it when that is not the `serve.py` on disk. Comparing version
  numbers left the old server running whenever an update also rewrote the
  launcher. `serve.py` re-execs itself when its own file changes.

## The library, the switch, the updates, the copies (v5.28.0)

Brought from Cozy Tavern (M16 shelves, M466 order and resting shelves, M301
A-to-Z pickers, M510 Quick switch, M141 the new-coat nudge, the device copies).

- **Folds and order live in `S.ui`** (`fold` keyed `p:<id>`, `pinned`,
  `loose`, `resting`; `sort` = used | name | newest), so they sync like any
  setting. Projects and the resting corner start folded; pinned and loose start
  open. `.sec-head`'s text is the label alone — the caret is CSS — because
  `v3test` reads it. "+" on a folded project unfolds it first.
- **"Last used" for a project** is the newest `updatedAt` of its chats, floored
  by when it was made (`createdAt`, or the time inside its uid), so a new empty
  project stands at the top instead of the bottom.
- **A resting project** is `archived: true` on the project; its chats keep
  their `projectId` and show only inside the corner. Pinned chats stay pinned.
- **The Quick switch** writes exactly what Settings' connection row writes
  (`providerId`, and `model` back to the connection's own), so it is the same
  act in a second place, as in Cozy Tavern.
- **`lookForUpdate()`** reloads only when `quietNow()` (no stream, empty
  composer, no modal, no message being edited, nothing waiting to be saved),
  once per version per tab (`sessionStorage`), one look at a time. Device
  mode asks `/api/version` on every event-stream (re)connect and on return to
  the tab; the site is asked at most hourly. Tests stub `reloadPage()`; in
  Playwright set the stub inside an arrow function, because a string that
  evaluates to a function is called by `page.evaluate`.
- **Copies** (`serve.py`): `make_backup()` runs at start and hourly, one per
  day, `BACKUP_KEEP` newest; `/api/backup/now|list|restore/<name>`. A restore
  is `replace_all()` — the trash first, then everything, then "reload" to every
  tab; the tab that asked reloads itself (`Device.reload`).

## hermesmodel (v5.28.1)

`tools/hermesmodel` is a Termux command the installer copies into
`$PREFIX/bin` (and the launcher's `update()` refreshes on every `cozy`). It
picks the provider and model Hermes Agent uses with typed numbers only — his
Termux keyboard breaks arrow-key menus, so never add one. It finds Hermes in
Termux or inside the proot Ubuntu `cozyai` uses, reads providers from
Hermes' own `config.yaml` (legacy `custom_providers` list and the
`providers:` dict), asks the provider's `/models` with the provider's own key,
and changes everything through `hermes config set` — `model.default` for a
model; `model.provider` + `model.base_url` + `model.default` for a provider;
`providers.<name>.api` + `.api_key` to add one. Never `hermes config set
model <x>`: that replaces the whole mapping. If the gateway answers on 8642 it
is restarted the way `cozyai` starts it. `HERMESMODEL_RUN` / `_PORT` exist for
the test, which runs against a real hermes-agent with Hermes' own resolver.

v5.28.2, after LO hit "invalid API key": the key is looked up the way Hermes
does — its resolver first, then the name Hermes' setup gives a custom
endpoint's key, `custom_endpoint_key_env(hostname + "_" + port)` →
`HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY` for api.neuralwatt.com. v5.28.1
built `HERMES_CUSTOM_API_<host>` (an extra `API_`), so on his phone no model
list ever came back; its test passed only because the test named its env var
after that same wrong rule. The test now asks Hermes for the name. Every change
is proven with one tiny chat request before it is kept, and put back exactly
as it was when the provider refuses the key or the model; the first line says
when Hermes' current provider refuses its key.

**Hermes' gateway key follows Hermes (v5.28.3).** LO's Cozy connection had an
old key and Hermes a new strong one (newer Hermes refuses placeholder or
short keys at startup), so every message was "Invalid gateway API key
(API_SERVER_KEY)". `sync_hermes_key()` in serve.py collects candidate keys from
Hermes' homes on the phone (`COZY_HERMES_HOME`, `HERMES_HOME`, `~/.hermes`,
every proot rootfs `root/.hermes` and `home/*/.hermes`; their `.env` and
`profiles/*/.env` `API_SERVER_KEY`, and `key:` values in `config.yaml`),
probes each loopback Hermes-looking connection (`preset: hermes`, model
`hermes-agent`, or an `API_SERVER_PORT`) with `GET /models`, and saves only a
key that answers 200 — under the store lock, skipped if a tab wrote the
settings meanwhile, announced `by: "server"` so every tab pulls it. It runs at
start, every `COZY_HERMES_SYNC_SECONDS` (20), and on `POST /api/hermes/sync`,
which the app calls when a Hermes connection is refused (the error then says
the key was taken; Retry sends) and when Test is refused (the field takes the
key and tests again). No endpoint ever returns a key. The provider editor's
key field follows a phone-side change unless it was typed over
(`dataset.loaded`).

**Settings import keeps both keys.** `_merge_settings` used to keep the phone's
connection and drop an incoming one with the same id, so a stale vault's dead
key could become the only key. A differing url/apiKey/model now arrives as a
copy "(from this browser)", and the whole incoming settings document is saved
to `imported/settings-<ms>.json`.

## Pictures for a vision model (v5.28.8, v5.28.9)

A picture is prepared once, as it is attached (`prepareImage`): decoded with
the camera's orientation applied, redrawn at most `IMG_EDGE` (2000) px on its
long edge, metadata gone. 2000, not v5.28.8's 2048: Claude refuses a picture
past 2000 px on a side in any request carrying more than 20 pictures (its
vision docs, "many-image requests"), and 22 wide screenshots fit the byte
budget easily. `prepareImage` never throws; it returns null. A JPEG source stays JPEG (q 0.88); anything else is
PNG while that is at most `IMG_PNG_MAX` (1.5 MB) - a screenshot stays sharp, a
sticker stays see-through - and JPEG on white past that. A file Chrome cannot
decode (HEIC) is refused by name; nothing undecodable is ever attached. Until
v5.28.7 the camera's bytes went out as they were: 4000x3000 sideways pixels
behind an orientation flag many services ignore, its GPS position, 3-5 MB
each - three in one chat made every request 16 MB, past Hermes'
`MAX_REQUEST_BYTES = 10_000_000`.

A picture keeps `w`, `h` and `thumb` (a `THUMB_EDGE` 480 px WebP data URL,
see-through kept). **The thread draws the thumb**, never the picture: v5.28.8
put each whole picture's data URL through `renderThread()`'s innerHTML and the
browser decoded it again on every redraw - 7.9 MB of HTML and 0.77-0.99 s per
redraw for nine photos on a 4x-slowed CPU, at the end of every reply and on
every switch to the chat; with thumbs it is 33 KB and 71 ms. A picture with no
thumb (v5.28.8 or older, until made ready) is drawn from a `blob:` link made
once per picture (`picShownSrc`, `picLinks`). The viewer shows the whole
picture (`picWholeSrc`, set as a property, never through HTML). Every value a
stored record puts into the thread is checked first - `PIC_MIME_RE`,
`THUMB_RE`, `B64_RE` - because a restored backup is a stored record: a mime
of `image/png" onerror="...` used to land inside the `<img>` tag.

**Pictures from before v5.28.9 are made ready once** (`readyPictures`), in
`send()` before any request is built from the chat - never on open, which
would write a chat another tab may be streaming into. Any picture without
`w`/`h` is decoded and prepared again; the chat keeps the result. One the
browser cannot open (HEIC) keeps its bytes and gets `raw: 1`, so it is not
tried again. v5.28.8 never sent an old picture past `IMG_ONE_MAX` again - a
camera photo of 4 MB is 5.4 M base64 characters - and sent the rest sideways
with their GPS position.

On the wire (`picturesToSend(c)`): every picture rides every request
again. The newest user message's pictures always go; older ones go
newest-first while they fit `IMG_WIRE_BUDGET` (6,000,000 base64 characters)
and `IMG_MAX_COUNT` (100 - Claude's limit on its 200k-token models). Never
sent (`pictureBarred`): a picture past `IMG_ONE_MAX` (5,000,000 - Claude's
limit on Bedrock and Vertex; its own API takes 10 MB), one with no data, and
one that is not JPEG, PNG, GIF or WebP (`WIRE_PIC_MIMES`) - on every
connection: Claude, OpenAI and OpenRouter all refuse the whole request over
one, and only a picture the browser could not open (`raw`, a HEIC) can be
anything else. One left out
is named in its own message ("[a picture ("x.jpg") was attached here; it is
not sent again...]", or "...it is not sent - <why>" when it never can be). A picture with no words is the whole message: no text part rides
with it, because Claude refuses a text part that is only whitespace, and Send
is ready with only a picture in the tray (`sendReady`). "Search every message"
does not search for a picture sent without words.

**Hermes and pictures** (read from its source): its chat completions keep
`image_url` parts in every message, and for a model that cannot see it
describes them itself. Its Runs API turns history into plain text
(`str(entry["content"])`), so a chat holding a picture is sent over the plain
stream (`useRuns` is false while any content is not a string). Hermes asks
for approval on that stream too (`event: approval.request`, the completion id
as `run_id`); Cozy shows the same card and answers
`POST /v1/runs/{run_id}/approval`. Before v5.28.8 that frame was dropped, so
the agent sat waiting with nothing on screen.

Hermes' approval frame carries a `description` (why it asks: "recursive
delete"); the card shows it on both transports (`.appr-why`).

**Counting.** The meter (`updateEmber`) counts attached text files as
`attachmentBody()` sends them and the pictures `picturesToSend()` sends, plus
the tray; v5.28.8 counted neither, so a 40,000-character file or ten photos
never moved it. A picture costs `picTokens()` - Claude's 28 px patches, at most
4784, 1600 when its size is unknown. What the model saw adds the same for the
pictures a request carried when the service sends no count
(`sentPicTokens`); a picture rode as "[an image]", three tokens.

A text file is fenced with one more backtick than its longest run
(`attachmentBody`), so its own code blocks cannot close the fence. Save &
resend refuses a message with no words and nothing attached, the same rule as
Send (an emptied message went out as an empty turn, which Claude refuses).

**Getting a message ready is part of sending.** `send()` waits before it
builds a request - on saving, on the web search, on `readyPictures` - and the
app used to look idle meanwhile: `streaming` was null, so Send stayed Send (a
second message started a second request into the same chat and the first
reply was cut off), `quietNow()` let an update reload in the middle, a chat
deleted meanwhile was saved back by the next `persistConvo()` and its message
sent anyway, and nothing could stop a slow search. Now `send()` takes the
controls at once with a `prep` AbortController as `streaming` (Send is Stop;
Stop, a delete, Clear or another send aborts it, and its abort listener hands
the controls back at once). `going()` is checked after every wait; the forced
search gets `prep.signal`, so Stop calls it off. More and Swipe are checked
before any of this (`tail.pending`), so Swipe on a reply still coming in
leaves it coming in instead of cutting it off. `release()` hands over to the
request's own controller.

**A save that fails is said** (`persistConvo` catches, toasts "Couldn't save
this chat - ...", and returns false). It used to throw: in `send()` that left
the message unsent with nothing said, and at a reply's end it skipped the
final draw. A success message after a save ("Branched", "Pinned", "Attached",
"Created", an undo) is shown only when the save worked, so it cannot cover
the failure. Only the browser's IndexedDB can refuse (full); the phone's store
queues every save and never rejects.

`tests/pictures_e2e.py` builds the pictures with pillow (a sideways 12 MP
photo with GPS, a 48 MP photo, a screenshot, a see-through sticker, an
undecodable HEIC, a v5.28.8-sized photo, 22 wide pictures) and reads back what
the model would receive; it measures the drawn thread's HTML and redraw time
on a 4x-slowed CPU, and makes old pictures ready through a real send.

## Writes come from the app (v5.28.4)

`serve.py` refuses a PUT, POST or DELETE without `X-Cozy-Client` (403). The
page names itself on every write; no other web page can put that header on a
request to 127.0.0.1 (a custom header needs a preflight the server never
grants). Before, any site open in the phone's browser could clear or replace
every chat with one `fetch()` it never needed to read the answer of —
`installtest.sh` proves the clear, the delete and the overwrite are refused. A
new write endpoint, or a new caller of one, has to send the header.

**The file editor keeps what was typed.** Closing it, attaching from it, or the
page going to the background saves the typing first (`keepDocEdit`, one undo
frame, the same as Save); a file deleted here or elsewhere just closes
(`hideDocEdit`). Closing used to drop every unsaved change, and Attach
attached the old text.

## The thinking box (v5.28.4)

It follows its own end while the reader is at that end, and **only the
reader's own scrolling of the box decides whether they are** (`thinkScrolled`,
caught by a capturing scroll listener on `#thread`, since a box's scroll does
not bubble). v5.28.3 decided it from where the box stood *after* the new text
landed (`stickScroll`), so any paint that grew it past the 40px margin at
once (the backlog that lands when a finger lifts, since painting is suspended
while one is down; a burst; a paragraph on a slow frame) read as "scrolled
away", and it never followed again. Its test ran the helper on a fake box with fixed
numbers and passed the whole time; it is gone, and `thinking_e2e.py` measures
the real thing (13 of its 24 checks fail on v5.28.3).

- Cozy's own scrolls go through `thinkPut`, which records the position in
  `thinkSeen`; a scroll event at that position is Cozy's echo and changes
  nothing.
- Out of reach of the end = reading (`thinkAway[mid]`); coming *down* into
  the end = following again. Moving *up* inside the margin changes nothing
  (a lifting finger twitches); an upward wheel marks reading on its own, so a
  touchpad's small steps are not pulled back one by one.
- `thinkOpen[mid]` is the reader's fold choice; absent means open while the
  reply arrives and folded once it is done. A `toggle` that only matches how
  Cozy drew the block is the drawing, not a choice. The live message is
  `streaming.asstId` (set in every mode; More never sets `pending`, and must
  not - `assembleMessages()` drops pending turns from the wire).
- The live box grows by `appendData`, never a rewrite: a rewrite each frame
  wiped any selection the reader made in it.
- `renderThread()` keeps each box's place, and `readerState()` keeps what the
  reader scrolled or opened elsewhere in a message (code blocks, tables, the
  image strip, an approval's command, a diff, the tool drawer, the sources
  list); the streaming paint keeps tables as it kept code blocks. A block the
  reader is up in when the reply finishes stays open where they are.

## Replies that never came (v5.28.4)

`_(stopped)_`, `_(empty reply)_` and the two lookup notes (`REPLY_NOTES`) are
Cozy's sentences stored as a reply's content. On the wire they go as an
`appNote()`, never as the model's words; and a reply that was all reasoning
(content `""`) goes as one too, because Claude refuses an empty turn anywhere
but last, so every later message in that chat used to fail. The final turn (the
one More carries on) is the exception: a placeholder there goes as `""`, and
More on such a reply starts it instead of carrying on from Cozy's line, which
comes back if nothing arrives. The lines that write the placeholders are
unchanged on purpose: `searchnegtest.js` mutates one of them verbatim.

**The Runs API is remembered as missing only when that is what happened.** A
404/405 is an answer. A failed fetch is also what a stopped Hermes looks like,
so it is remembered only after the plain stream proves the server answers;
v5.28.3 switched approvals off for good every time Hermes was not running.

**An error body is read once** (`errDetail`): as text, then as JSON when it
is JSON. Reading it as JSON first spent it, so a plain-text or HTML error
always said "No details given."

## What the model saw

- `assembleMessages(kind, c, partsOut)` fills `partsOut` with every part,
  recorded where that part is placed. It is an out-parameter on purpose: the
  return value is the wire and nothing else — `v510test`/`v5260test` count
  texts in it, and a parts list riding inside it doubled every count.
- `send()` keeps every request that came back answered (`sentReqs`), with the
  provider's own usage when it streams one, and `Sent.keep()` stores it.
  `sent` is a VARIANT_FIELD, so each version of a reply keeps its own.
- Records are piece-deduplicated (`Sent.encode`): strings of 512+ characters
  are cut at paragraph breaks chosen by content hash and stored once per chat.
  Device: `sent/<chat>.json`, pruned by serve.py to the newest 200 records
  with unreferenced pieces dropped. Browser: the `cozychat-sent` IndexedDB,
  same rules.
- The API key travels in headers; a record holds `url` and `body` only.
- An IndexedDB `get()` that finds nothing has `result === undefined` — resolve
  with that, not with the request object (that bug lost every record in
  browser mode before it shipped).

## Files on the wire

One rule, and every part of the file subsystem is downstream of it: **the file
the model reads is the file that exists.** Anything that puts a second body for
the same name in front of it — a stale copy, a dropped excerpt, a heading that
describes something other than what was sent — is the same defect wearing a
different hat, and it always produces the same three symptoms: text located
that isn't there, edits already applied proposed again, and turns that no
longer look different from each other.

- **A file's contents are never stored in a conversation.** `addAttachments()`
  keeps the text on the message because that is what the user attached, but
  `assembleMessages()` decides at request time which bodies actually go out —
  `attachmentPlan()` / `attachmentBody()`. A conversation is append-only; a
  file is mutable. Writing the second into the first is what put five copies of
  one file on the wire. Two rules resolve it: an editable file of that name is
  the only truth for that name, so no snapshot of it is sent at all; among
  snapshots of a name with no editable file, only the newest carries its text.
  Every suppressed copy leaves one line saying where the current text is, so
  the turn still records that a file was attached there.
- **`authorshipLine()` must never be able to lie.** It tells the model its
  applied edits are already present in the text above. Anything that trims the
  file has to keep those spans — `appliedTextsByFile()` feeds them to
  `relevantChunks()` as must-keeps. Undone edits are excluded (they are not in
  the file) and `replace_all` is excluded (its replacement is the whole file).
- **A heading describes what was actually sent.** A smart-mode file that fits
  inside the retrieval budget arrives whole and is not labelled an excerpt —
  otherwise the excerpt rule forbids a full rewrite of a file the model can
  see all of.

## App notes inside a turn

Cozy appends notes to an assistant turn on the wire — the edit-state note, the
parse-failure note, "nothing was changed". They belong next to the reply they
describe, but they are **not** the reply, and two rules follow from that:

- **Every one is wrapped by `appNote()`**, which names Cozy as the author and
  tells the model never to write one. Unattributed, they sat inside the
  assistant's own turn, so the model read its past replies as ending that way
  and began writing them itself.
- **No note may spell a tag the parser scans for.** The system prompt teaches
  `<docedits>` and must; a note may not. When the note named it, every echo put
  an unclosed opener in a real reply — parsed as a cut-off block, reported as
  "cut off before anything usable arrived", and stripped from the tag to the
  end of the message, so the visible reply stopped mid-sentence. `v519test.js`
  asserts no conversation turn contains the tag while the system prompt does.

"Nothing was changed" answers "is it done?", which is only ever asked about the
newest reply. It goes on the last assistant message and nowhere else — stamped
on every turn it was dozens of identical copies teaching the model to write it.

**An unclosed opener is a cut-off block only when the tail opens like one** — a
list, an object, or a fence. The tag turns up in ordinary prose, and treating
that as truncation deletes the rest of a reply that was never truncated.
Likewise a block cut off after emptying keeps its warning: with nothing staged,
the warning is the whole story, and dropping it described the reply as one that
proposed no edits at all.

## Looking things up

Every trigger that predates v5.21.0 answered "does this need the internet?"
**before the model had read the message** — a magnifier tap, "search every
message", or a regex on the wording. The one participant that knows whether it
knows was never asked, and on a Claude connection the tool that *would* have
asked it was gated behind `opts.search`: the person had to decide first, which
is the opposite of automatic. Two mechanisms replace that, and the rule under
both is that the decision belongs to the model.

- **On Anthropic with the native provider**, `useNative` no longer waits for
  `opts.search`. The tool rides every turn; Anthropic bills per *search*, not
  per tool on the request, so an unused one costs nothing. The magnifier and
  "every message" still force it. `skipOnTools` means a prefill now skips on a
  Claude connection with search on — that is the documented trade, not a bug.
- **Everywhere else** there is no tool, so the request travels as text:
  `searchProtocol()` teaches a `<websearch>` block, `parseSearchCall()`
  recognizes one, `runModelSearch()` runs it, and the loop in `send()` asks the
  same turn again. Text, not function calling, is what makes it work on any
  endpoint including the Hermes Runs transport, with nothing hardcoded about a
  model.

Four rules hold it together, each with a mutation in `searchnegtest.js`:

- **A reply is a request only when it is nothing else.** One recognizer decides
  both whether to search and whether to strip, so prose that merely names the
  tag — explaining the protocol, quoting it in a fence — can never be gutted
  by the stripper. Two recognizers would drift apart and one of them would eat
  an answer.
- **The request is cleared the moment it is recognized**, before anything that
  can fail. A round can end at the search, at an abort, at a superseded send,
  or at its last permitted round, and on every one of those paths the tag is
  already gone. Held until after the search, a failure leaves the request
  standing as the reply. Each exit leaves the sentence that replaces it —
  `searchNote` — because "(empty reply)" says the model produced nothing, when
  it produced a request Cozy could not carry out.
- **A search that came back empty still goes on the wire.** Silence reads as
  "the lookup never happened" and produces the identical request a second time,
  so the query is recorded *before* the fetch and an empty result ships as
  `(nothing came back)`.
- **`<web_results>` names what was asked for.** A forced search records its
  query too — without it the model cannot tell an answered query from an
  unanswered one, whoever asked for the search. A conversation saved before
  this release has neither `searchedFor` nor `searchDone`, so its block is
  byte-for-byte what it was and reopening an old chat changes no request it
  makes; `searchtest.js` pins that shape and `v2test.js` pins the live forced
  path that now names its query.

`inerttest.js` re-seeds settings before every shape. It used to share one
settings object across the whole run, so a shape that switched search on left
it on for every shape after it and the comparison reported a later shape as
changed because of an earlier one.

## The seam between the user and the instruction set

Anthropic has no system role inside the message list, so a system block travels
as a user turn. Consecutive user turns then merge — here, and again at the API.
Unlabelled, the instruction set's standing blocks read as the newest thing the
user said. `sysAsUser()` names the seam, which leaves exactly one unlabelled
user voice on the wire: the person typing. The label is Anthropic-only; on a
real system role it would be noise.

The fold itself is not optional on that wire. Consecutive same-role turns are
merged by the first-party API but rejected by Bedrock and by proxies in front
of it, so the shape has to leave `assembleMessages()` already correct. That is
why the fold handles mixed string/block content: a turn carrying an image is a
list of blocks, and requiring two strings used to leave an image turn sitting
next to a renamed system block as two user turns in a row. Empty strings are
dropped rather than folded in — an empty text block is a 400.

## Prefill

Ported from the SillyTavern **Prefill Control** extension, and deliberately
not a copy of it. That extension spends most of its code predicting a
SillyTavern *server* it cannot see — whether post-processing will merge the
prefilled turn into its predecessor and discard it. Cozy has no such server:
it assembles the prompt and posts it. So the prefill runs on the finished list
in `buildPayload()`, after the squash in `assembleMessages()`, and the message
that leaves `buildPayload()` is the message on the wire. None of the merge
prediction was carried over, because none of it can happen here.

Four invariants, each with a mutation in `prefillnegtest.js`:

- **Nothing is written until every skip has been ruled out.** A report of
  "skipped" means the request went out exactly as `assembleMessages()` built
  it, and the gate asserts that by comparing the list before and after.
- **A turn that came from the conversation is never rewritten.** Fields may be
  added to it — that is what a continuation flag is for — but its text is
  left alone. The extension's `preset` mode rewrites it, which on **More**
  would move the first paragraph of a real reply into the thinking field.
- **The wire decides which fields exist, and the user decides their names.**
  `pfWire()` reads `p.kind`, which is a choice made when the connection was
  created, not a guess from the model string. Anthropic gets the turn and
  nothing else.
- **The prefill lives in `buildPayload()`, never in `assembleMessages()`.**
  The Hermes Runs transport assembles its own list and maps it to
  `{role, content}`; an assistant tail there empties the run's `input`.

**A test that builds its own request tests itself.** `pfTest()` goes through
`buildPayload()` with `opts.probe`, which swaps the conversation and nothing
else — provider, field names, tags, thinking style and every guard are the
live ones. A probe is not a message, so it does not touch `lastPrefill`, and
it ignores an existing refusal because clearing one is half its job.

**A status code is not a verdict.** A service can accept the trailing turn and
drop it, which is a 200 either way. The probe sequence exists so continuation
has a deterministic answer, and the flag and the thinking field get their own
probes — sent only when they can distinguish something — because a rejected
field and a rejected turn are different repairs.

**A verdict describes the settings it was produced under.** `pfFingerprint()`
lists them; when it moves, the line is cleared. Every control in that list has
to re-render, or a green light outlives what it was about.

**A tag that is seeded must be a tag that is closed and caught.** Two
mechanisms put a whole reply in the thinking block or spill reasoning into the
prose, and neither is the model misbehaving. `splitReasoning()` treats
everything after an unclosed opening tag as thinking, so a prefill that seeds
one into the visible text and leaves the model to close it produces an empty
message and a thinking block containing the story — `applyPrefill()` closes it
instead. And `thinkTags` and the prefill's `openTag` are two settings that had
to agree with nothing checking them, so `tagPairs()` now takes the prefill's
own tag from the setting that produced it.

**The shipped default is the one that cannot fail.** `PF_DEFAULT` carries no
`flagField` and no `reasoningField`. `partial` is a Moonshot field, and on
most other endpoints an unknown key on a message is a 400 — so defaulting to
it meant switching the prefill on broke the user's next real *message*, not a
test, on every connection but one. A field set is an opt-in with a button next
to it. The mutation reverting this is in `prefillnegtest.js`; keep it.

Capability that cannot be read off a model name is learned from the wire.
Claude 4.6+ refuses a prefilled turn with a 400; `markPrefillDown()` records
that on the connection, the message is re-sent without the prefill rather than
lost, and re-saving the connection clears the mark — the same bargain
`markRunsDown()` makes for the Runs API.

## Release

Bump `const VERSION` and the header comment in `index.html` together. Commit
message is plain language: `vX.Y.Z — what changed, from the user's side`.

A commit that adds or fixes only tests is not a release and does not bump
`VERSION` — the app checks that string for updates, and a bump with nothing
behind it tells every install there is something new to fetch.
