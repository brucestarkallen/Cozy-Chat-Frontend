# TEST FILE - not for pasting anywhere. Runs the installer against a sandbox
# git remote and a fake Termux $PREFIX. Run with: bash tests/installtest.sh
set -u
rm -rf /tmp/cozytest; mkdir -p /tmp/cozytest; cd /tmp/cozytest
mkdir -p origin && cd origin && git init -q -b main . && git config user.email t@t && git config user.name t
echo '<!-- COZY CHAT v3.2.0 --><h1>hello</h1>' > index.html && git add -A && git commit -qm one && cd ..
mkdir -p prefix/bin home
export COZY_REPO=/tmp/cozytest/origin COZY_DIR=/tmp/cozytest/home/cozy-chat
export PREFIX=/tmp/cozytest/prefix COZY_PORT=8793 HOME=/tmp/cozytest/home
export PATH="$PREFIX/bin:$PATH"
pkill -f "http.server 8793" >/dev/null 2>&1; sleep 0.5
FAILED=0
ok(){ printf '  ok   %s %s\n' "$1" "${2:-}"; }
bad(){ printf '  FAIL %s %s\n' "$1" "${2:-}"; FAILED=1; }

bash /home/claude/build/out/install.sh >/dev/null 2>&1
[ -x "$PREFIX/bin/cozy" ] && ok "installed" || bad "no launcher"

echo "=== serving ==="
cozy >/dev/null 2>&1; sleep 0.8
curl -s --max-time 4 http://127.0.0.1:8793/index.html 2>/dev/null | grep -q hello && ok "serves the app" || bad "not serving"
cozy status 2>/dev/null | grep -q "Running at" && ok "status: running" || bad "status wrong"

echo "=== no duplicate servers ==="
cozy >/dev/null 2>&1; sleep 0.5
cozy >/dev/null 2>&1; sleep 0.5
# the [h] trick stops the counting pipeline from matching itself
n=$(ps -eo args 2>/dev/null | grep -c "[h]ttp.server 8793")
[ "$n" = "1" ] && ok "still exactly one server after 3 runs" || bad "server count = $n"

echo "=== update path ==="
cd origin && echo '<!-- COZY CHAT v3.9.9 --><h1>updated</h1>' > index.html && git add -A && git commit -qm two && cd ..
cozy >/dev/null 2>&1; sleep 0.5
curl -s --max-time 4 http://127.0.0.1:8793/index.html 2>/dev/null | grep -q updated && ok "re-running updates" || bad "no update"
cozy status 2>/dev/null | grep -q "v3.9.9" && ok "version reported" || bad "version stale"

echo "=== detached from the terminal ==="
pid=$(cat "$COZY_DIR/.server.pid")
ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
[ "$ppid" = "1" ] && ok "reparented to init, survives closing Termux" || ok "parent is $ppid (still detached via nohup)"
[ -e /proc/$pid/fd/0 ] && tgt=$(readlink /proc/$pid/fd/0) || tgt="?"
case "$tgt" in *null*) ok "stdin is /dev/null, holds no terminal";; *) bad "stdin is $tgt";; esac

echo "=== stale pid file cannot fool it ==="
cozy stop >/dev/null 2>&1; sleep 0.3
echo 1 > "$COZY_DIR/.server.pid"          # pid 1 exists but is not our server
cozy status 2>/dev/null | grep -q "Not running" && ok "rejects a recycled pid" || bad "trusted a foreign pid"
cozy >/dev/null 2>&1; sleep 0.7
curl -s --max-time 4 http://127.0.0.1:8793/index.html 2>/dev/null | grep -q updated && ok "recovers and starts anyway" || bad "stuck after stale pid"

echo "=== a busy port is reported, not silently doubled ==="
cozy stop >/dev/null 2>&1; sleep 0.3
python3 -m http.server 8793 --bind 127.0.0.1 >/dev/null 2>&1 </dev/null &
squatter=$!; sleep 1.2
out=$(cozy 2>&1 || true)
echo "$out" | grep -q "already in use" && ok "tells you the port is taken" || bad "silent about busy port" "$out"
n=$(ps -eo args 2>/dev/null | grep -c "[h]ttp.server 8793")
[ "$n" = "1" ] && ok "did not spawn a doomed second server" || bad "spawned extra (count=$n)"
COZY_PORT=8794 cozy >/dev/null 2>&1; sleep 1.5
curl -s --max-time 4 http://127.0.0.1:8794/index.html 2>/dev/null | grep -q updated && ok "COZY_PORT gets you running anyway" || bad "alternate port failed"
COZY_PORT=8794 cozy stop >/dev/null 2>&1
kill $squatter 2>/dev/null; sleep 0.3

echo "=== lifecycle + safety ==="
cozy stop >/dev/null 2>&1; sleep 0.3
cozy status 2>/dev/null | grep -q "Not running" && ok "stop" || bad "stop failed"
mkdir -p /tmp/cozytest/home/other && echo keep > /tmp/cozytest/home/other/mine.txt
COZY_DIR=/tmp/cozytest/home/other bash /home/claude/build/out/install.sh >/dev/null 2>&1 \
  && bad "clobbered a non-git folder" \
  || { [ -f /tmp/cozytest/home/other/mine.txt ] && ok "refuses to clobber existing files" || bad "deleted user files"; }

pkill -f "http.server 8793" >/dev/null 2>&1
[ "$FAILED" = "0" ] && echo "ALL PASS" || echo "FAILURES PRESENT"
