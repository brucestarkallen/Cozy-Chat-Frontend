# Working on Cozy Chat

Single-file PWA: all app code lives in `index.html`. `sw.js` is the service
worker, `install.sh` the Termux installer, `tests/` the gate.

## Gate — run before every push

    npm i jsdom fake-indexeddb        # once per workspace
    for t in tests/*.js; do node "$t" || exit 1; done
    bash tests/installtest.sh

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

## Release

Bump `const VERSION` and the header comment in `index.html` together. Commit
message is plain language: `vX.Y.Z — what changed, from the user's side`.
