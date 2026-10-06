#!/usr/bin/env bash
# ============================================================
# Cozy Chat — Termux installer, updater, and launcher
#
#   curl -fsSL https://raw.githubusercontent.com/brucestarkallen/Cozy-Chat-Frontend/main/install.sh | bash
#
# Safe to run again any time — re-running is how you update.
# Creates a "cozy" command that updates, serves, and opens the app.
# ============================================================
set -euo pipefail

LAUNCHER_V=4
REPO="${COZY_REPO:-https://github.com/brucestarkallen/Cozy-Chat-Frontend.git}"
DIR="${COZY_DIR:-$HOME/cozy-chat}"
PORT="${COZY_PORT:-8787}"
BIN="${PREFIX:-/usr/local}/bin"

say()  { printf '\033[38;5;180m%s\033[0m\n' "$*"; }
warn() { printf '\033[38;5;209m%s\033[0m\n' "$*"; }
die()  { printf '\033[38;5;167m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------- dependencies ----------
if command -v pkg >/dev/null 2>&1; then
  need=""
  command -v git    >/dev/null 2>&1 || need="$need git"
  command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || need="$need python"
  if [ -n "$need" ]; then
    say "Installing:$need"
    pkg install -y $need >/dev/null 2>&1 || pkg install -y $need
  fi
fi
command -v git >/dev/null 2>&1 || die "git is missing. Run: pkg install git"
PY=$(command -v python3 || command -v python) || die "python is missing. Run: pkg install python"

# ---------- fetch or update ----------
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" fetch --quiet origin
  # The working copy is never edited by hand, so a hard reset is the
  # reliable update: it cannot leave a half-merged tree behind.
  git -C "$DIR" reset --hard --quiet origin/HEAD 2>/dev/null \
    || git -C "$DIR" reset --hard --quiet origin/main
elif [ -e "$DIR" ]; then
  die "$DIR exists but is not a git checkout. Move or delete it, then run this again."
else
  say "Downloading into $DIR"
  git clone --quiet --depth 1 "$REPO" "$DIR"
fi

VER=$(grep -o 'COZY CHAT v[0-9.]*' "$DIR/index.html" 2>/dev/null | head -1 || echo "Cozy Chat")

# ---------- the launcher ----------
mkdir -p "$BIN"
cat > "$BIN/cozy" <<LAUNCHER
#!/usr/bin/env bash
# Cozy Chat launcher — written by install.sh, safe to overwrite.
set -euo pipefail
LAUNCHER_V=$LAUNCHER_V
DIR="\${COZY_DIR:-$DIR}"
PORT="\${COZY_PORT:-$PORT}"
BIND="\${COZY_BIND:-127.0.0.1}"
PID="\$DIR/.server.pid"
LOG="\$DIR/.server.log"
URL="http://\$BIND:\$PORT/"
PY=\$(command -v python3 || command -v python)

# A recorded pid can be recycled by an unrelated process after a reboot, so
# confirm the process really is our server before trusting or killing it.
running() {
  [ -f "\$PID" ] || return 1
  p=\$(cat "\$PID" 2>/dev/null) || return 1
  [ -n "\$p" ] && kill -0 "\$p" 2>/dev/null || return 1
  if [ -r "/proc/\$p/cmdline" ]; then
    tr '\\0' ' ' < "/proc/\$p/cmdline" | grep -qE "serve\\.py|http\\.server" || return 1
  fi
  return 0
}

# What the server on the port says it is: the stamp of the serve.py it runs,
# or nothing (not running, or a server from before it could say).
server_code() {
  "\$PY" - "\$BIND" "\$PORT" <<'PYCODE' 2>/dev/null
import json, sys, urllib.request
try:
    with urllib.request.urlopen("http://%s:%s/api/version" % (sys.argv[1], sys.argv[2]), timeout=2) as r:
        print(json.loads(r.read().decode("utf-8")).get("code", ""))
except Exception:
    print("")
PYCODE
}

# The stamp of the serve.py on disk - what a server started now would say.
file_code() {
  "\$PY" -c 'import hashlib,sys; print(hashlib.sha1(open(sys.argv[1],"rb").read()).hexdigest()[:12])' "\$DIR/serve.py" 2>/dev/null || true
}

# Is the thing on the port a Cozy Chat server (of any age)?
cozy_on_port() {
  "\$PY" - "\$BIND" "\$PORT" <<'PYCOZY' 2>/dev/null
import sys, urllib.request
try:
    with urllib.request.urlopen("http://%s:%s/" % (sys.argv[1], sys.argv[2]), timeout=2) as r:
        sys.exit(0 if b"COZY CHAT v" in r.read(262144) else 1)
except Exception:
    sys.exit(1)
PYCOZY
}

# A Cozy server on our port that this launcher holds no pid for - started by
# an older launcher or by hand - found by its command line and stopped.
kill_orphan() {
  for d in /proc/[0-9]*; do
    c=\$(tr '\\0' ' ' < "\$d/cmdline" 2>/dev/null) || continue
    case "\$c" in *"serve.py \$PORT "*|*"serve.py \$PORT") kill "\${d#/proc/}" 2>/dev/null || true ;; esac
  done
}

# Something else may already hold the port — another copy started outside
# cozy, or a different server entirely. Starting a second one just produces
# a process that dies on bind, so check first and say so plainly.
port_taken() {
  "\$PY" - "\$BIND" "\$PORT" <<'PORTCHECK' 2>/dev/null
import socket, sys
s = socket.socket(); s.settimeout(0.5)
code = s.connect_ex((sys.argv[1], int(sys.argv[2])))
s.close()
sys.exit(0 if code == 0 else 1)
PORTCHECK
}

start() {
  running && return 0
  rm -f "\$PID"
  if port_taken && cozy_on_port; then
    kill_orphan
    n=0; while port_taken && [ \$n -lt 30 ]; do sleep 0.1; n=\$((n+1)); done
  fi
  if port_taken; then
    echo "Port \$PORT is already in use by something else."
    echo "Either stop that, or pick another port:  COZY_PORT=8788 cozy"
    exit 1
  fi
  cd "\$DIR"
  # nohup + closed stdin so the server survives closing Termux and never
  # holds the terminal open. nohup execs directly, so \$! is the real pid.
  # serve.py forbids caching. Plain http.server answers 304, which lets a
  # browser keep showing files you already replaced — an update that pulls
  # fine but changes nothing on screen.
  if [ -f "\$DIR/serve.py" ]; then
    nohup "\$PY" "\$DIR/serve.py" "\$PORT" "\$BIND" >"\$LOG" 2>&1 </dev/null &
  else
    nohup "\$PY" -m http.server "\$PORT" --bind "\$BIND" >"\$LOG" 2>&1 </dev/null &
  fi
  echo \$! > "\$PID"
  n=0
  while [ \$n -lt 25 ]; do
    running && return 0
    n=\$((n+1)); sleep 0.2
  done
  rm -f "\$PID"
  echo "Server did not start. Recent output:"; tail -n 15 "\$LOG" 2>/dev/null
  echo "If the port is busy, try:  COZY_PORT=8788 cozy"
  exit 1
}

# Waits for the server to be gone: a start straight after a kill used to find
# the dying server still answering, take it as running, and leave nothing up.
stop() {
  if running; then
    p=\$(cat "\$PID")
    kill "\$p" 2>/dev/null || true
    n=0
    while kill -0 "\$p" 2>/dev/null && [ \$n -lt 30 ]; do sleep 0.1; n=\$((n+1)); done
    kill -0 "\$p" 2>/dev/null && kill -9 "\$p" 2>/dev/null || true
  fi
  rm -f "\$PID"
}

update() {
  git -C "\$DIR" fetch --quiet origin
  git -C "\$DIR" reset --hard --quiet origin/HEAD 2>/dev/null \\
    || git -C "\$DIR" reset --hard --quiet origin/main
  # the Hermes helper ships with the app and is refreshed with it
  if [ -f "\$DIR/tools/hermesmodel" ] && [ -n "\${PREFIX:-}" ]; then
    cp -f "\$DIR/tools/hermesmodel" "\$PREFIX/bin/hermesmodel" 2>/dev/null && chmod 755 "\$PREFIX/bin/hermesmodel" 2>/dev/null || true
  fi
}

open_url() {
  if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "\$URL"
  else echo "Open this in your browser:  \$URL"; fi
}

ver() { grep -o 'COZY CHAT v[0-9.]*' "\$DIR/index.html" 2>/dev/null | head -1 | sed 's/.*v//'; }

# The launcher is written by install.sh, so a newer install.sh in the repo
# means this script itself is out of date. Re-run it once and carry on.
relaunch_if_stale() {
  [ -f "\$DIR/install.sh" ] || return 0
  want=\$(grep -m1 '^LAUNCHER_V=' "\$DIR/install.sh" | cut -d= -f2)
  [ -n "\$want" ] || return 0
  [ "\$want" = "\$LAUNCHER_V" ] && return 0
  echo "Updating the cozy command itself (v\$LAUNCHER_V -> v\$want)…"
  COZY_DIR="\$DIR" COZY_PORT="\$PORT" bash "\$DIR/install.sh" >/dev/null 2>&1 || true
  exec "\$0" "\${1:-run}"
}

case "\${1:-run}" in
  run)
    # the version from before the update survives this command rewriting itself
    before=\${COZY_BEFORE:-\$(ver)}
    export COZY_BEFORE="\$before"
    update
    relaunch_if_stale run
    after=\$(ver)
    if [ "\$before" != "\$after" ]; then echo "Updated \$before -> \$after"; else echo "Already on \$after"; fi
    # A server still running older code than the files on disk is relit. The
    # server itself is asked, not version numbers compared - an update that
    # also rewrote this command compared two new numbers and left the old
    # server serving.
    if running && [ "\$(server_code)" != "\$(file_code)" ]; then stop; fi
    start
    echo "Cozy Chat is at \$URL"
    open_url
    ;;
  update)  update; echo "Updated. Restart with: cozy restart"; ;;
  stop)    stop; echo "Stopped."; ;;
  restart) stop; start; echo "Running at \$URL"; ;;
  status)
    if running; then echo "Running at \$URL  (pid \$(cat "\$PID"))"
    else echo "Not running."; fi
    echo "Files on disk: v\$(ver)"
    echo "Your chats: \${COZY_DATA_DIR:-\$HOME/.cozychat}"
    ;;
  log)     tail -n 40 "\$LOG" 2>/dev/null || echo "No log yet."; ;;
  path)    echo "\$DIR"; ;;
  data)    echo "\${COZY_DATA_DIR:-\$HOME/.cozychat}"; ;;
  *)
    echo "cozy            update, serve, and open"
    echo "cozy update     pull the latest without restarting"
    echo "cozy restart    restart the server"
    echo "cozy stop       stop the server"
    echo "cozy status     is it running, and which version"
    echo "cozy log        recent server output"
    echo "cozy path       where the app's files live"
    echo "cozy data       where your chats live"
    echo "hermesmodel     pick the provider and model Hermes uses"
    ;;
esac
LAUNCHER
chmod +x "$BIN/cozy"

say ""
say "$VER installed."
say ""
say "  cozy          update, serve, and open"
say "  cozy status   check it"
say "  cozy stop     stop the server"
say ""
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) warn "Note: $BIN is not on your PATH. Run it as $BIN/cozy" ;;
esac
# the Hermes helper: one command to pick Hermes' provider and model
if [ -f "$COZY_DIR/tools/hermesmodel" ]; then
  cp -f "$COZY_DIR/tools/hermesmodel" "$BIN/hermesmodel" && chmod 755 "$BIN/hermesmodel"
fi

say "Your chats live on this phone in ${COZY_DATA_DIR:-$HOME/.cozychat} - every browser"
say "that opens http://127.0.0.1:$PORT/ shows the same ones, and clearing a"
say "browser can't touch them. Chats a browser kept before this version move"
say "onto the phone the first time it opens."
