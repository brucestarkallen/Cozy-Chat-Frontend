#!/bin/bash
# TEST FILE - run with: HERMES_BIN=/path/to/hermes HERMES_SRC=/path/to/hermes-agent bash tests/hermesmodeltest.sh
# Runs tools/hermesmodel against a real Hermes Agent install (its own `hermes config set` and its own
# provider resolver), a stand-in provider that lists models only for the right key, and a stand-in
# gateway on a spare port. Skips without HERMES_BIN. Proven on hermes-agent a928a959 (Oct 2026).
[ -z "${HERMES_BIN:-}" ] && { echo "SKIP: set HERMES_BIN (a hermes executable) and HERMES_SRC (its source tree)"; exit 0; }
HERE="$(cd "$(dirname "$0")" && pwd)"
W=$(mktemp -d); mkdir -p "$W/hm" "$W/hbin"; cp "$HERE/hermesmodel/fakeprov.py" "$W/"
HPY="$(head -1 "$HERMES_BIN" | sed 's/^#!//')"
sed "s#/home/claude/hermes-src#$HERMES_SRC#" "$HERE/hermesmodel/resolve.py" > "$W/resolve.py"
cat > "$W/hbin/hermes" <<HB
#!$HPY
import os, sys
if sys.argv[1:2] == ["gateway"]:
    os.execv("/usr/bin/python3", ["python3", "-c", "import http.server as h\nclass H(h.BaseHTTPRequestHandler):\n def log_message(s,*a): pass\n def do_GET(s): s.send_response(200); s.end_headers(); s.wfile.write(b'ok')\nh.HTTPServer(('127.0.0.1',8699),H).serve_forever()", "hermes", "gateway"])
os.execv("$HERMES_BIN", ["hermes"] + sys.argv[1:])
HB
chmod +x "$W/hbin/hermes"
cd "$W"
export HERMESMODEL_RUN="env HERMES_HOME=$W/hm PATH=$W/hbin:$(dirname "$HERMES_BIN"):/usr/bin:/bin bash -c" HERMESMODEL_PORT=8699 HOME="$W"
T="$HERE/../tools/hermesmodel"
pass=0; fail=0
ck(){ if eval "$2"; then echo "  ok   $1"; pass=$((pass+1)); else echo "  FAIL $1"; fail=$((fail+1)); fi; }
FP=""
curl -sf -o /dev/null http://127.0.0.1:9911/nw/v1/models -H "Authorization: Bearer nw-secret" || { python3 fakeprov.py >/dev/null 2>&1 & FP=$!; sleep 0.5; }
GW="hermes"" gateway"
pkill -f "$GW" 2>/dev/null; sleep 0.3
cat > hm/config.yaml <<'Y'
model:
  default: glm-5.2-fast
  provider: neuralwatt
  base_url: http://127.0.0.1:9911/nw/v1
custom_providers:
- name: neuralwatt
  base_url: http://127.0.0.1:9911/nw/v1
  api_key: ${HERMES_CUSTOM_API_127_0_0_1_9911_API_KEY}
agent:
  max_turns: 150
Y
echo 'HERMES_CUSTOM_API_127_0_0_1_9911_API_KEY=nw-secret' > hm/.env
echo "=== A. a model on the current provider, Hermes not running"
out=$(printf '3\n' | bash $T 2>&1)
ck "the list is the provider's own, the current one marked" 'printf "%s" "$out" | grep -q "2  glm-5.2-fast   <- now"'
ck "the pick is set, the provider kept" 'grep -q "default: kimi-k2.7-code" hm/config.yaml && grep -q "provider: neuralwatt" hm/config.yaml'
ck "it says Hermes starts with it next time" 'printf "%s" "$out" | grep -q "next time you run cozyai"'
echo "=== B. a new provider, Hermes running"
nohup $W/hbin/hermes gateway >/dev/null 2>&1 &
for i in $(seq 1 20); do curl -sf -o /dev/null http://127.0.0.1:8699/health && break; sleep 0.2; done
old=$(pgrep -f "$GW" | head -1)
out=$(printf 'p\na\nwafer\nhttp://127.0.0.1:9911/wf/v1\nwf-secret\n1\n' | bash $T 2>&1)
new=$(pgrep -f "$GW" | head -1)
ck "its models were asked with its own key" 'printf "%s" "$out" | grep -q "1  deepseek-v4"'
ck "provider, address, key and model all set" 'grep -q "provider: wafer" hm/config.yaml && grep -q "default: deepseek-v4" hm/config.yaml && grep -q "api: http://127.0.0.1:9911/wf/v1" hm/config.yaml && grep -q "api_key: wf-secret" hm/config.yaml'
ck "Hermes was restarted and answers" '[ -n "$new" ] && [ "$old" != "$new" ] && curl -sf -o /dev/null http://127.0.0.1:8699/health && printf "%s" "$out" | grep -q "Hermes is back"'
ck "Hermes itself resolves the new route" 'HERMES_HOME=$W/hm "$HPY" "$W/resolve.py" 2>/dev/null | grep -q "\"base_url\": \"http://127.0.0.1:9911/wf/v1\""'
echo "=== C. back to the first provider from the list"
out=$(printf 'p\n1\n2\n' | bash $T 2>&1)
ck "both providers are listed" 'printf "%s" "$out" | grep -q "1  neuralwatt" && printf "%s" "$out" | grep -q "2  wafer"'
ck "switched back with the model picked" 'grep -q "provider: neuralwatt" hm/config.yaml && grep -q "default: glm-5.2-fast" hm/config.yaml'
ck "and Hermes resolves it with neuralwatt's key" 'HERMES_HOME=$W/hm "$HPY" "$W/resolve.py" 2>/dev/null | grep -q "nw/v1"'
echo "=== D. a typo, 0, or Enter change nothing"
cp hm/config.yaml before.yaml
for ans in 'x9' '0' '' '99' 'p\n7' 'p\n0'; do printf "$ans\n" | bash $T >/dev/null 2>&1; done
ck "the config is untouched" 'cmp -s hm/config.yaml before.yaml'
echo "=== E. a provider that won't list its models: type the name"
sed -i 's|api_key: wf-secret|api_key: wrong-key|' hm/config.yaml
out=$(printf 'p\n2\nmy-exact-model\n' | bash $T 2>&1)
ck "it says so and takes a typed name" 'printf "%s" "$out" | grep -q "didn.t list its models" && grep -q "default: my-exact-model" hm/config.yaml && grep -q "provider: wafer" hm/config.yaml'
pkill -f "$GW" 2>/dev/null
[ -n "$FP" ] && kill "$FP" 2>/dev/null
echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
