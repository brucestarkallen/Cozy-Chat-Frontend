# Working on Cozy Chat

Single-file PWA: all app code lives in `index.html`. `sw.js` is the service
worker, `install.sh` the Termux installer, `tests/` the gate.

## Gate — run before every push

    npm i jsdom fake-indexeddb        # once per workspace
    for t in tests/*.js; do node "$t" || exit 1; done
    bash tests/installtest.sh

1239 checks as of v5.16.0, measured from real output. `tests/v516negtest.js` is
in that loop but is a *meta* gate: it runs `v516test.js` 24 times against a
mutated `index.html` and takes several minutes. Run it on its own, or in
slices (`node tests/v516negtest.js 0 9`), after touching a prefill guard.

It edits `index.html` in place. A `.negbak` is written before the first
mutation and restored at startup if a previous run was killed — without that,
an interrupted run leaves the bug in the tree looking like code somebody
wrote, and the next gate failure reads as a real defect.

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

## Prefill

Ported from the SillyTavern **Prefill Control** extension, and deliberately
not a copy of it. That extension spends most of its code predicting a
SillyTavern *server* it cannot see — whether post-processing will merge the
prefilled turn into its predecessor and discard it. Cozy has no such server:
it assembles the prompt and posts it. So the prefill runs on the finished list
in `buildPayload()`, after the squash in `assembleMessages()`, and the message
that leaves `buildPayload()` is the message on the wire. None of the merge
prediction was carried over, because none of it can happen here.

Four invariants, each with a mutation in `v516negtest.js`:

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

Capability that cannot be read off a model name is learned from the wire.
Claude 4.6+ refuses a prefilled turn with a 400; `markPrefillDown()` records
that on the connection, the message is re-sent without the prefill rather than
lost, and re-saving the connection clears the mark — the same bargain
`markRunsDown()` makes for the Runs API.

## Release

Bump `const VERSION` and the header comment in `index.html` together. Commit
message is plain language: `vX.Y.Z — what changed, from the user's side`.
