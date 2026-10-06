#!/bin/bash
# TEST FILE - run with: HERMES_BIN=/path/to/hermes bash tests/hermesmodeltest.sh
# tools/hermesmodel against a real Hermes Agent install - its own `hermes config set`, its own key
# naming (custom_endpoint_key_env), its own resolver - plus two stand-in providers (401 on a wrong
# key, 404 on a model they lack) and a stand-in gateway. Skips without HERMES_BIN.
[ -z "${HERMES_BIN:-}" ] && { echo "SKIP: set HERMES_BIN to a hermes executable"; exit 0; }
HERE="$(cd "$(dirname "$0")" && pwd)"; T="$HERE/../tools/hermesmodel"
W=$(mktemp -d); mkdir -p "$W/hm" "$W/hbin"; cd "$W"
HPY="$(head -1 "$HERMES_BIN" | sed 's/^#!//')"
GW="hermes"" gateway"
cat > "$W/hbin/hermes" <<HB
#!$HPY
import os, sys
if sys.argv[1:2] == ["gateway"]:
    os.execv("/usr/bin/python3", ["python3", "-c", "import http.server as h\\nclass H(h.BaseHTTPRequestHandler):\\n def log_message(s,*a): pass\\n def do_GET(s): s.send_response(200); s.end_headers(); s.wfile.write(b'ok')\\nh.HTTPServer(('127.0.0.1',8699),H).serve_forever()", "hermes", "gateway"])
os.execv("$HERMES_BIN", ["hermes"] + sys.argv[1:])
HB
chmod +x "$W/hbin/hermes"
export HERMESMODEL_RUN="env HERMES_HOME=$W/hm PATH=$W/hbin:$(dirname "$HERMES_BIN"):/usr/bin:/bin bash -c" HERMESMODEL_PORT=8699 HOME="$W"
python3 "$HERE/hermesmodel/fakeprov.py" >/dev/null 2>&1 & FP=$!; sleep 0.6
# the name Hermes' own setup gives the key of an endpoint at 127.0.0.1:9911
KEYNAME="$(HERMES_HOME="$W/hm" "$HPY" -c 'from hermes_cli.config import custom_endpoint_key_env; print(custom_endpoint_key_env("127.0.0.1_9911"))')"
cat > hm/config.yaml <<Y
model:
  default: glm-5.2-fast
  provider: neuralwatt
  base_url: http://127.0.0.1:9911/v1
custom_providers:
- name: neuralwatt
  base_url: http://127.0.0.1:9911/v1
agent:
  max_turns: 150
Y
echo "$KEYNAME=nw-secret" > hm/.env
pass=0; fail=0
ck(){ if eval "$2"; then echo "  ok   $1"; pass=$((pass+1)); else echo "  FAIL $1"; fail=$((fail+1)); fi; }
echo "=== A. the key lives only in .env, named the way Hermes names it ($KEYNAME)"
out=$(printf '3\n' | bash "$T" 2>&1)
ck "the models are listed with that key" 'printf "%s" "$out" | grep -q "2  glm-5.2-fast   <- now"'
ck "no warning about the key" '! printf "%s" "$out" | grep -q "taking Hermes. key"'
ck "the pick is tested, then kept" 'printf "%s" "$out" | grep -q "answered a test message" && grep -q "default: kimi-k2.7-code" hm/config.yaml && grep -q "provider: neuralwatt" hm/config.yaml'
echo "=== B. a new provider, Hermes running"
nohup "$W/hbin/hermes" gateway >/dev/null 2>&1 &
for i in $(seq 1 20); do curl -sf -o /dev/null http://127.0.0.1:8699/health && break; sleep 0.2; done
old=$(pgrep -f "$GW" | head -1)
out=$(printf 'p\na\nwafer\nhttp://127.0.0.1:9912/v1\nwf-secret\n1\n' | bash "$T" 2>&1)
new=$(pgrep -f "$GW" | head -1)
ck "its models are asked with its own key" 'printf "%s" "$out" | grep -q "1  deepseek-v4"'
ck "provider, address, key and model set" 'grep -q "provider: wafer" hm/config.yaml && grep -q "default: deepseek-v4" hm/config.yaml'
ck "Hermes restarted and answers" '[ -n "$new" ] && [ "$old" != "$new" ] && printf "%s" "$out" | grep -q "Hermes is back"'
echo "=== C. back to the first provider"
out=$(printf 'p\n1\n1\n' | bash "$T" 2>&1)
ck "switched back, tested" 'grep -q "provider: neuralwatt" hm/config.yaml && grep -q "default: glm-5.2$" hm/config.yaml && printf "%s" "$out" | grep -q "answered a test message"'
echo "=== D. a typo, 0 or Enter change nothing"
cp hm/config.yaml before.yaml
for ans in 'x9' '0' '' '99' 'p\n7' 'p\n0'; do printf "$ans\n" | bash "$T" >/dev/null 2>&1; done
ck "the config is untouched" 'cmp -s hm/config.yaml before.yaml'
echo "=== E. a provider whose key is wrong"
"$HERMES_BIN" --help >/dev/null 2>&1
HERMES_HOME="$W/hm" "$HERMES_BIN" config set providers.wafer.api_key wrong-key >/dev/null 2>&1
out=$(printf 'p\n2\nglm-5.2\n' | bash "$T" 2>&1)
ck "choosing it is tested and refused" 'printf "%s" "$out" | grep -q "That didn.t work"'
ck "and put back exactly as it was" 'grep -q "provider: neuralwatt" hm/config.yaml && grep -q "default: glm-5.2$" hm/config.yaml && grep -q "base_url: http://127.0.0.1:9911/v1" hm/config.yaml'
HERMES_HOME="$W/hm" "$HERMES_BIN" config set model.provider wafer >/dev/null 2>&1
HERMES_HOME="$W/hm" "$HERMES_BIN" config set model.base_url http://127.0.0.1:9912/v1 >/dev/null 2>&1
out=$(printf '0\n' | bash "$T" 2>&1)
ck "when Hermes already sits on it, the first line says so" 'printf "%s" "$out" | grep -q "isn.t taking Hermes. key right now: it turned the key down (401)"'
HERMES_HOME="$W/hm" "$HERMES_BIN" config set model.provider neuralwatt >/dev/null 2>&1
HERMES_HOME="$W/hm" "$HERMES_BIN" config set model.base_url http://127.0.0.1:9911/v1 >/dev/null 2>&1
echo "=== F. a model the provider does not have"
out=$(printf 'p\n1\n0\n' | bash "$T" 2>&1); cp hm/config.yaml before.yaml
HERMES_HOME="$W/hm" "$HERMES_BIN" config set model.default no-such-model >/dev/null 2>&1
out=$(printf '1\n' | bash "$T" 2>&1)
ck "a working pick from the list still goes through" 'grep -q "default: glm-5.2$" hm/config.yaml'
pkill -f "$GW" 2>/dev/null; kill "$FP" 2>/dev/null
echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
