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
# a stand-in Hermes with nothing set up: the reason a provider listed no models
# is printed (it was always empty brackets from v5.28.2 to v5.28.4)
mkdir -p /tmp/upd/fakeh/bin /tmp/upd/fakeh/home
printf '#!%s\nimport sys\nsys.exit(0)\n' "$(command -v python3)" > /tmp/upd/fakeh/bin/hermes; chmod +x /tmp/upd/fakeh/bin/hermes
hm=$(printf '\n' | PATH="/tmp/upd/fakeh/bin:$PATH" HERMES_HOME=/tmp/upd/fakeh/home HERMESMODEL_RUN="bash -c" bash "$PREFIX/bin/hermesmodel" 2>&1)
printf '%s\n' "$hm" | grep -q "didn't list its models (no address is set for it)" && ok "hermesmodel says why no models were listed" || bad "no reason given" "$(printf '%s' "$hm" | grep "list its models")"

# a choice whose test fails is put back - the model, and a provider added for it: taken out again when
# it was new, its old address and key back when it was one added again with a fresh key. A stand-in Hermes
# keeps its config.yaml with \`hermes config set/unset\` (the real one's commands), and a stand-in provider
# takes only right-key.
mkdir -p /tmp/upd/fakeh2/bin /tmp/upd/fakeh2/home
cat > /tmp/upd/fakeh2/bin/hermes <<HERMES
#!$(command -v python3)
import os, sys, yaml
p = os.path.join(os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes"), "config.yaml")
try:
    cfg = yaml.safe_load(open(p)) or {}
except OSError:
    cfg = {}
a = sys.argv[1:]
if a[:2] == ["config", "set"] and len(a) == 4:
    ks = a[2].split("."); d = cfg
    for k in ks[:-1]:
        d = d.setdefault(k, {})
    d[ks[-1]] = a[3]
elif a[:2] == ["config", "unset"] and len(a) == 3:
    ks = a[2].split("."); chain = [cfg]
    for k in ks[:-1]:
        nxt = chain[-1].get(k) if isinstance(chain[-1], dict) else None
        if not isinstance(nxt, dict):
            sys.exit(1)
        chain.append(nxt)
    if ks[-1] not in chain[-1]:
        sys.exit(1)
    del chain[-1][ks[-1]]
    for i in range(len(ks) - 1, 0, -1):
        if chain[i] == {}:
            del chain[i - 1][ks[i - 1]]
else:
    sys.exit(0)
yaml.safe_dump(cfg, open(p, "w"), default_flow_style=False)
HERMES
chmod +x /tmp/upd/fakeh2/bin/hermes
pport=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
python3 - "$pport" >/dev/null 2>&1 <<'PROV' & ppid=$!
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def ok(self):
        if self.headers.get("Authorization") == "Bearer right-key":
            return True
        self.send_response(401); self.end_headers(); self.wfile.write(b'{"detail":"Invalid API key"}'); return False
    def do_GET(self):
        if self.ok():
            self.send_response(200); self.end_headers(); self.wfile.write(json.dumps({"data": [{"id": "m1"}]}).encode())
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.ok():
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"choices":[{"message":{"content":"ok"}}]}')
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PROV
sleep 0.5
H2=/tmp/upd/fakeh2/home
printf 'model:\n  default: m1\n  provider: firstp\n  base_url: http://127.0.0.1:%s/v1\nproviders:\n  firstp:\n    api: http://127.0.0.1:%s/v1\n    api_key: right-key\n' "$pport" "$pport" > $H2/config.yaml
hm2() { HERMESMODEL_RUN="env HERMES_HOME=$H2 PATH=/tmp/upd/fakeh2/bin:/usr/bin:/bin bash -c" HERMESMODEL_PORT=1 bash "$PREFIX/bin/hermesmodel" 2>&1; }
hm=$(printf 'p\na\nwafer\nhttp://127.0.0.1:%s/v1\nwrong-key\nm1\n' "$pport" | hm2)
printf '%s' "$hm" | grep -q "That didn't work" && ok "(a new provider whose test fails is refused)" || bad "no failed test" "$(printf '%s' "$hm" | tail -3)"
! grep -q wafer $H2/config.yaml && grep -q "provider: firstp" $H2/config.yaml && ok "and the provider added for it is taken out again with the model put back" || bad "the added provider stayed" "$(cat $H2/config.yaml)"
hm=$(printf 'p\na\nfirstp\nhttp://127.0.0.1:%s/v1\nwrong-key\nm1\n' "$pport" | hm2)
python3 -c 'import sys,yaml; c=yaml.safe_load(open(sys.argv[1])); sys.exit(0 if c["providers"]["firstp"]["api_key"]=="right-key" and c["model"]["provider"]=="firstp" else 1)' $H2/config.yaml \
  && printf '%s' "$hm" | grep -q "That didn't work" && ok "a provider added again with a key that fails keeps its old key" || bad "the old key was lost" "$(cat $H2/config.yaml)"
# a provider added, then the model left unchosen (Enter, or 0): "Nothing changed" has to be true
hm=$(printf 'p\na\nwafer2\nhttp://127.0.0.1:%s/v1\nwrong-key\n\n' "$pport" | hm2)
printf '%s' "$hm" | grep -q "Nothing changed" && ! grep -q wafer2 $H2/config.yaml && ok "a provider added and then no model typed is taken out again" || bad "the provider stayed though nothing changed" "$(cat $H2/config.yaml)"
hm=$(printf 'p\na\nwafer3\nhttp://127.0.0.1:%s/v1\nright-key\n0\n' "$pport" | hm2)
printf '%s' "$hm" | grep -q "Nothing changed" && ! grep -q wafer3 $H2/config.yaml && ok "so is one whose model list is left with 0" || bad "the provider stayed after 0" "$(cat $H2/config.yaml)"
kill $ppid 2>/dev/null

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
sed -i 's/^LAUNCHER_V=[0-9][0-9]*$/LAUNCHER_V=8/' "$PREFIX/bin/cozy"      # pretend ours differs from the repo's
sed -i 's/^LAUNCHER_V=[0-9][0-9]*$/LAUNCHER_V=9/' /tmp/upd/origin/install.sh
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

echo "--- no network: cozy still starts the version already on the phone ---"
onphone=$(grep -o 'COZY CHAT v[0-9.]*' "$COZY_DIR/index.html" | head -1 | sed 's/.*v//')
mv /tmp/upd/origin /tmp/upd/origin-away                     # GitHub can't be reached
cozy stop >/dev/null 2>&1
cozy >/tmp/upd/r5.log 2>&1; rc=$?; sleep 1
[ "$rc" = "0" ] && ok "cozy finishes with no network" || bad "cozy stopped at the fetch" "rc=$rc: $(head -2 /tmp/upd/r5.log)"
grep -q "Couldn't reach GitHub" /tmp/upd/r5.log && ok "it says it couldn't reach GitHub" || bad "nothing said about the network" "$(cat /tmp/upd/r5.log)"
grep -q "Starting the version already on this phone ($onphone)" /tmp/upd/r5.log && ok "and that it starts the version already on the phone" || bad "no word of what it starts" "$(cat /tmp/upd/r5.log)"
curl -s --max-time 3 http://127.0.0.1:8803/api/store/chat/t1 | grep -q '"title":"kept"' && ok "the server is up, with the chats" || bad "nothing is serving"
cozy update >/tmp/upd/r6.log 2>&1; rc=$?
[ "$rc" != "0" ] && grep -q "Couldn't reach GitHub" /tmp/upd/r6.log && ok "cozy update says so too, and fails" || bad "cozy update with no network" "rc=$rc: $(cat /tmp/upd/r6.log)"
mv /tmp/upd/origin-away /tmp/upd/origin
# a network that takes the request and never answers is given up on, not waited on
hport=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
python3 -c 'import socket,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(8)
held=[]
while True:
    c,_=s.accept(); held.append(c)' "$hport" >/dev/null 2>&1 & hpid=$!
git -C "$COZY_DIR" remote set-url origin "http://127.0.0.1:$hport/cozy.git"
cozy stop >/dev/null 2>&1
t0=$(date +%s); COZY_FETCH_TIMEOUT=3 timeout 40 cozy >/tmp/upd/r7.log 2>&1; rc=$?; t1=$(date +%s); sleep 1
[ "$rc" = "0" ] && [ $((t1 - t0)) -lt 20 ] && grep -q "Couldn't reach GitHub" /tmp/upd/r7.log && ok "a fetch that never answers is given up on, and the server starts" || bad "a fetch that never answers" "rc=$rc after $((t1 - t0)) s: $(cat /tmp/upd/r7.log)"
curl -s --max-time 3 http://127.0.0.1:8803/api/store/hello | grep -q '"store": 2' && ok "the server answers" || bad "nothing serving after it"
kill $hpid 2>/dev/null; git -C "$COZY_DIR" remote set-url origin "file:///tmp/upd/origin"

echo "--- cozy stop stops every Cozy server for the chats, its pid on record or not ---"
cozy restart >/dev/null 2>&1; sleep 0.5
rm -f "$COZY_DIR/.server.pid"                                # a server cozy holds no pid for (started by hand, or an older cozy)
out=$(cozy stop 2>&1); sleep 0.3
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:8803/api/store/hello)
[ "$code" = "000" ] && printf '%s' "$out" | grep -q "^Stopped." && ok "cozy stop stops a server it has no pid for, and says Stopped" || bad "cozy stop and a server with no pid" "said: $out; it answers: $code"
pkill -f "serve.py 8803" >/dev/null 2>&1; sleep 0.3                # (whatever that left, gone)
( cd /tmp/upd && nohup python3 "$COZY_DIR/serve.py" 8807 127.0.0.1 >/tmp/upd/other.log 2>&1 </dev/null & )
n=0; while ! curl -s --max-time 1 -o /dev/null http://127.0.0.1:8807/api/store/hello && [ $n -lt 40 ]; do sleep 0.1; n=$((n+1)); done
curl -s --max-time 2 http://127.0.0.1:8807/api/store/hello | grep -q "\"dataDir\": \"$HOME/.cozychat\"" && ok "(a server for the same chats answers on 8807)" || bad "no server on 8807" "$(tail -2 /tmp/upd/other.log)"
out=$(cozy stop 2>&1); sleep 0.3
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:8807/api/store/hello)
[ "$code" = "000" ] && printf '%s' "$out" | grep -q "^Stopped." && ok "and one for the same chats on another port (bash serve.sh 8807)" || bad "cozy stop left the other port serving the chats" "said: $out; 8807 answers: $code"
( cd /tmp/upd && nohup python3 "$COZY_DIR/serve.py" 8807 127.0.0.1 >/tmp/upd/other.log 2>&1 </dev/null & )
n=0; while ! curl -s --max-time 1 -o /dev/null http://127.0.0.1:8807/api/store/hello && [ $n -lt 40 ]; do sleep 0.1; n=$((n+1)); done
curl -s --max-time 2 http://127.0.0.1:8807/api/store/hello | grep -q "\"dataDir\": \"$HOME/.cozychat\"" && ok "(a server for the same chats answers on 8807 again)" || bad "no server on 8807" "$(tail -2 /tmp/upd/other.log)"
cozy >/tmp/upd/r8.log 2>&1; rc=$?; sleep 0.5
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:8807/api/store/hello)
[ "$rc" = "0" ] && [ "$code" = "000" ] && curl -s --max-time 3 http://127.0.0.1:8803/api/store/chat/t1 | grep -q '"title":"kept"' && ok "cozy takes the chats over from a server on another port, and serves them" || bad "cozy with a server for the chats on another port" "rc=$rc 8807=$code: $(tail -3 /tmp/upd/r8.log)"
pkill -f "serve.py 8807" >/dev/null 2>&1
# a server that stops again at once (here: its data folder cannot be made) is not reported as running
out=$(COZY_DATA_DIR=/proc/nonexistent/chats cozy restart 2>&1); rc=$?
[ "$rc" != "0" ] && printf '%s' "$out" | grep -q "Server did not start" && ! printf '%s' "$out" | grep -q "Running at" && ok "a server that stops again at once is not reported as running" || bad "a dead start reported as running" "rc=$rc: $(printf '%s' "$out" | head -3)"
cozy restart >/dev/null 2>&1

pkill -f "serve.py 8803" >/dev/null 2>&1

echo "--- bash serve.sh, the README's other way to run it from Termux ---"
mkdir -p /tmp/upd/ss-data
( COZY_DATA_DIR=/tmp/upd/ss-data nohup bash "$SRC/serve.sh" 8805 >/tmp/upd/ss.log 2>&1 </dev/null & echo $! > /tmp/upd/ss.pid )
n=0; while ! curl -s --max-time 1 -o /dev/null http://127.0.0.1:8805/ && [ $n -lt 40 ]; do sleep 0.1; n=$((n+1)); done
curl -s --max-time 3 http://127.0.0.1:8805/api/store/hello | grep -q '"dataDir": "/tmp/upd/ss-data"' && ok "serve.sh keeps the chats on the phone" || bad "serve.sh is not the phone store" "$(head -c 120 /tmp/upd/ss.log)"
curl -s --max-time 3 http://127.0.0.1:8805/index.html | grep -q 'name="cozy-store"' && ok "and the page it serves knows it" || bad "no store tag from serve.sh"
kill "$(cat /tmp/upd/ss.pid)" 2>/dev/null; sleep 0.3

echo "--- the README's one-line install, with nothing set but where to fetch from ---"
mkdir -p /tmp/upd/home2 /tmp/upd/prefix2/bin
( unset COZY_DIR; HOME=/tmp/upd/home2 PREFIX=/tmp/upd/prefix2 bash "$SRC/install.sh" >/tmp/upd/fresh.log 2>&1 ); rc=$?
[ "$rc" = "0" ] && ok "a fresh install with no COZY_DIR finishes" || bad "a fresh install with no COZY_DIR stopped" "$(tail -1 /tmp/upd/fresh.log)"
[ -x /tmp/upd/prefix2/bin/hermesmodel ] && ok "and installs hermesmodel" || bad "no hermesmodel after a fresh install"
grep -q "Your chats live on this phone" /tmp/upd/fresh.log && ok "and says where the chats live" || bad "the install never got to its last words"
# the gate reads exit codes, so a failure has to be one
[ "$FAILED" = "0" ] && echo "ALL PASS" || { echo "FAILURES PRESENT"; exit 1; }
