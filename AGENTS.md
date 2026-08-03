# Working on Cozy Chat

Single-file PWA: all app code lives in `index.html`. `sw.js` is the service
worker, `install.sh` the Termux installer, `tests/` the gate.

## Gate — run before every push

    npm i jsdom fake-indexeddb        # once per workspace
    for t in tests/*.js; do
      [ "$t" = tests/prefillnegtest.js ] && continue
      node "$t" || exit 1
    done
    bash tests/installtest.sh

1327 checks as of v5.17.1, measured from real output.

`tests/prefillnegtest.js` is held out of that loop because it is a *meta*
gate: it runs a prefill gate once per mutation against a mutated `index.html`,
plus a control run of each, and
takes over ten minutes. Run it on its own after touching a prefill guard, in
slices if a session cannot hold a long call:

    node tests/prefillnegtest.js          # all 39
    node tests/prefillnegtest.js 0 9      # a slice

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
