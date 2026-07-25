# TEST FILE - not for pasting anywhere. Runs the installer against a sandbox
# git remote (file:// so --depth is honoured) and a fake Termux $PREFIX.
# Run with: bash tests/installtest.sh
set -u
rm -rf /tmp/upd; mkdir -p /tmp/upd; cd /tmp/upd
mkdir -p origin prefix/bin home
cd origin && git init -q -b main . && git config user.email t@t && git config user.name t
cp /home/claude/build/out/serve.py .
echo '<!-- COZY CHAT v1.0.0 --><h1>old</h1>' > index.html
cp /home/claude/build/out/install.sh .
git add -A && git commit -qm one && cd ..
export COZY_REPO="file:///tmp/upd/origin" COZY_DIR=/tmp/upd/home/cozy-chat
export PREFIX=/tmp/upd/prefix HOME=/tmp/upd/home COZY_PORT=8803
export PATH="$PREFIX/bin:$PATH"
FAILED=0; ok(){ printf '  ok   %s %s\n' "$1" "${2:-}"; }; bad(){ printf '  FAIL %s %s\n' "$1" "${2:-}"; FAILED=1; }
pkill -f "serve.py 8803" >/dev/null 2>&1; sleep 0.3

bash /home/claude/build/out/install.sh >/dev/null 2>&1
[ -f "$COZY_DIR/.git/shallow" ] && ok "clone is shallow (like the real one)" || bad "not shallow — path untested again"

cozy >/tmp/upd/r1.log 2>&1; sleep 1
grep -q "Already on 1.0.0" /tmp/upd/r1.log && ok "reports the version it is on" || bad "no version line" "$(head -3 /tmp/upd/r1.log)"
curl -s --max-time 3 http://127.0.0.1:8803/index.html | grep -q old && ok "serving" || bad "not serving"
ps -eo args | grep -q "[s]erve.py 8803" && ok "using the no-cache server" || bad "still on http.server"

echo "--- publish an update ---"
cd origin && echo '<!-- COZY CHAT v2.0.0 --><h1>new</h1>' > index.html && git add -A && git commit -qm two && cd ..
cozy >/tmp/upd/r2.log 2>&1; sleep 1
grep -q "Updated 1.0.0 -> 2.0.0" /tmp/upd/r2.log && ok "announces the update" || bad "no update line" "$(head -4 /tmp/upd/r2.log)"
grep -q "v2.0.0" "$COZY_DIR/index.html" && ok "files on disk updated" || bad "files stale"
curl -s --max-time 3 http://127.0.0.1:8803/index.html | grep -q new && ok "the SERVER serves the new file" || bad "server still serving old"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "If-Modified-Since: Wed, 01 Jan 2020 00:00:00 GMT" http://127.0.0.1:8803/index.html)
[ "$code" = "200" ] && ok "no 304, so a browser cannot hold a stale copy" || bad "got $code"
cozy status 2>/dev/null | grep -q "v2.0.0" && ok "status shows the version on disk" || bad "status wrong"

echo "--- the launcher updates itself ---"
sed -i 's/^LAUNCHER_V=2/LAUNCHER_V=3/' "$PREFIX/bin/cozy"   # pretend ours is newer than repo's
sed -i 's/^LAUNCHER_V=2/LAUNCHER_V=9/' /tmp/upd/origin/install.sh
cd origin && git add -A && git commit -qm three && cd ..
cozy >/tmp/upd/r3.log 2>&1; sleep 1
grep -q "Updating the cozy command itself" /tmp/upd/r3.log && ok "detects its own launcher is stale" || bad "did not self-update" "$(head -4 /tmp/upd/r3.log)"
grep -q "^LAUNCHER_V=9" "$PREFIX/bin/cozy" && ok "launcher rewritten to the repo version" || bad "launcher not rewritten"
curl -s --max-time 3 http://127.0.0.1:8803/index.html >/dev/null 2>&1 && ok "still serving after self-update" || bad "broke after self-update"

pkill -f "serve.py 8803" >/dev/null 2>&1
[ "$FAILED" = "0" ] && echo "ALL PASS" || echo "FAILURES PRESENT"
