# TEST FILE - not for pasting anywhere. Runs the installer against a sandbox
# git remote (file:// so --depth is honoured) and a fake Termux $PREFIX.
# Run with: bash tests/installtest.sh
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf /tmp/upd; mkdir -p /tmp/upd; cd /tmp/upd
mkdir -p origin prefix/bin home
cd origin && git init -q -b main . && git config user.email t@t && git config user.name t
cp "$SRC/serve.py" .
echo '<!-- COZY CHAT v1.0.0 --><h1>old</h1>' > index.html
cp "$SRC/install.sh" .
mkdir -p tools && cp "$SRC/tools/hermesmodel" tools/
git add -A && git commit -qm one && cd ..
export COZY_REPO="file:///tmp/upd/origin" COZY_DIR=/tmp/upd/home/cozy-chat
export PREFIX=/tmp/upd/prefix HOME=/tmp/upd/home COZY_PORT=8803
export PATH="$PREFIX/bin:$PATH"
FAILED=0; ok(){ printf '  ok   %s %s\n' "$1" "${2:-}"; }; bad(){ printf '  FAIL %s %s\n' "$1" "${2:-}"; FAILED=1; }
pkill -f "serve.py 8803" >/dev/null 2>&1; sleep 0.3

bash "$SRC/install.sh" >/dev/null 2>&1
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

echo "--- the Hermes helper ---"
[ -x "$PREFIX/bin/hermesmodel" ] && ok "hermesmodel is installed as a command" || bad "no hermesmodel"
bash -n "$PREFIX/bin/hermesmodel" && ok "and it is a valid script" || bad "hermesmodel has a syntax error"
sed -n 2p "$PREFIX/bin/hermesmodel" | grep -q "^# hermesmodel - " && ok "its second line describes it (for the menu command)" || bad "no description line"

echo "# helper release two" >> /tmp/upd/origin/tools/hermesmodel
( cd /tmp/upd/origin && git add -A && git commit -qm "helper two" )
cozy update >/dev/null 2>&1
grep -q "helper release two" "$PREFIX/bin/hermesmodel" && ok "an update refreshes the helper too" || bad "the helper stayed old after an update"

echo "--- the phone keeps the data ---"
curl -s --max-time 3 http://127.0.0.1:8803/index.html | grep -q 'name="cozy-store"' && ok "the served page says the phone keeps the data" || bad "no store tag in the served page"
grep -q 'name="cozy-store"' "$COZY_DIR/index.html" && bad "the tag leaked into the file on disk" || ok "the file on disk stays clean"
curl -s --max-time 3 http://127.0.0.1:8803/api/store/hello | grep -q "\"dataDir\": \"$HOME/.cozychat\"" && ok "the data lives in ~/.cozychat, outside the app" || bad "wrong data dir" "$(curl -s http://127.0.0.1:8803/api/store/hello)"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 -X PUT -H "X-Cozy-Client: installtest" -H "X-Cozy-Base: 0" --data '{"id":"t1","title":"kept"}' http://127.0.0.1:8803/api/store/chat/t1)
[ "$code" = "200" ] && ok "a chat is written" || bad "write got $code"
[ -f "$HOME/.cozychat/chats/t1.json" ] && ok "as a file on the phone" || bad "no chat file"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 -X PUT -H "X-Cozy-Client: installtest" -H "X-Cozy-Base: 0" --data '{"id":"t1","title":"stale"}' http://127.0.0.1:8803/api/store/chat/t1)
[ "$code" = "409" ] && ok "a write from an old revision is refused" || bad "stale write got $code"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 -X PUT -H "X-Cozy-Client: installtest" -H "X-Cozy-Base: 1" --data 'this is not json' http://127.0.0.1:8803/api/store/chat/t1)
[ "$code" = "400" ] && ok "garbage is refused" || bad "garbage got $code"
# a write that does not come from the app - any other web page open in the
# phone's browser - cannot touch the chats: it cannot send X-Cozy-Client
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 -X POST http://127.0.0.1:8803/api/store/clear/chat)
[ "$code" = "403" ] && ok "another page cannot clear the chats" || bad "a write without X-Cozy-Client cleared: $code"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 -X DELETE http://127.0.0.1:8803/api/store/chat/t1)
[ "$code" = "403" ] && ok "nor delete one" || bad "a delete without X-Cozy-Client got $code"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 -X PUT -H "X-Cozy-Base: 1" --data '{"id":"t1","title":"hijacked"}' http://127.0.0.1:8803/api/store/chat/t1)
[ "$code" = "403" ] && ok "nor overwrite one" || bad "a write without X-Cozy-Client got $code"
curl -s --max-time 3 http://127.0.0.1:8803/api/store/chat/t1 | grep -q '"title":"kept"' && ok "the good copy survived all of it" || bad "a bad write overwrote it"
cozy update >/dev/null 2>&1
[ -f "$HOME/.cozychat/chats/t1.json" ] && ok "the chats survive an app update (reset --hard)" || bad "an update ate the chats"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8803/.server.pid)
[ "$code" = "404" ] && ok "the server's own files are not served" || bad ".server.pid got $code"

echo "--- an old server is relit when the launcher rewrites itself ---"
# exactly the first update from v5.26.1: the running server is the old
# serve.py (no /api/version), started by the old launcher, and the release
# rewrites the cozy command too
git -C "$SRC" show d79dfe9:serve.py > "$COZY_DIR/serve.py"
cozy restart >/dev/null 2>&1; sleep 1
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:8803/api/version)
[ "$code" = "404" ] && ok "an old server is running (it has no /api/version)" || bad "not the old server" "$code"
sed -i 's/^LAUNCHER_V=4/LAUNCHER_V=5/' "$PREFIX/bin/cozy"      # pretend ours differs from the repo's
sed -i 's/^LAUNCHER_V=4/LAUNCHER_V=9/' /tmp/upd/origin/install.sh
echo "# release three" >> /tmp/upd/origin/serve.py
cd origin && echo '<!-- COZY CHAT v3.0.0 --><h1>three</h1>' > index.html && git add -A && git commit -qm three && cd ..
cozy >/tmp/upd/r3.log 2>&1; sleep 1
grep -q "Updating the cozy command itself" /tmp/upd/r3.log && ok "detects its own launcher is stale" || bad "did not self-update" "$(head -4 /tmp/upd/r3.log)"
grep -q "^LAUNCHER_V=9" "$PREFIX/bin/cozy" && ok "launcher rewritten to the repo version" || bad "launcher not rewritten"
grep -q "Updated 2.0.0 -> 3.0.0" /tmp/upd/r3.log && ok "and still reports the update it made" || bad "update line lost across the rewrite" "$(cat /tmp/upd/r3.log)"
want=$(python3 -c 'import hashlib,sys; print(hashlib.sha1(open(sys.argv[1],"rb").read()).hexdigest()[:12])' "$COZY_DIR/serve.py")
got=$(curl -s --max-time 3 http://127.0.0.1:8803/api/version | python3 -c 'import json,sys; print(json.load(sys.stdin).get("code",""))' 2>/dev/null)
[ -n "$want" ] && [ "$want" = "$got" ] && ok "the server running is the serve.py on disk" || bad "old server still serving" "want $want got $got"
curl -s --max-time 3 http://127.0.0.1:8803/api/store/chat/t1 | grep -q '"title":"kept"' && ok "and it still has the chats" || bad "chats lost across the relight"

echo "--- a server with no pid on record is still the one replaced ---"
rm -f "$COZY_DIR/.server.pid"
echo "# release four" >> /tmp/upd/origin/serve.py
cd origin && echo '<!-- COZY CHAT v4.0.0 --><h1>four</h1>' > index.html && git add -A && git commit -qm four && cd ..
cozy >/tmp/upd/r4.log 2>&1; sleep 1
grep -q "already in use" /tmp/upd/r4.log && bad "refused its own orphan" "$(cat /tmp/upd/r4.log)" || ok "an orphan Cozy server does not block the start"
want=$(python3 -c 'import hashlib,sys; print(hashlib.sha1(open(sys.argv[1],"rb").read()).hexdigest()[:12])' "$COZY_DIR/serve.py")
got=$(curl -s --max-time 3 http://127.0.0.1:8803/api/version | python3 -c 'import json,sys; print(json.load(sys.stdin).get("code",""))' 2>/dev/null)
[ "$want" = "$got" ] && ok "the new server answers" || bad "wrong server" "want $want got $got"
[ -f "$COZY_DIR/.server.pid" ] && kill -0 "$(cat "$COZY_DIR/.server.pid")" 2>/dev/null && ok "and its pid is on record again" || bad "no pid"

pkill -f "serve.py 8803" >/dev/null 2>&1
# the gate reads exit codes, so a failure has to be one
[ "$FAILED" = "0" ] && echo "ALL PASS" || { echo "FAILURES PRESENT"; exit 1; }
