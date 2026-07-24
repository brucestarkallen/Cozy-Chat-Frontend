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
    tr '\\0' ' ' < "/proc/\$p/cmdline" | grep -q "http.server" || return 1
  fi
  return 0
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
  if port_taken; then
    echo "Port \$PORT is already in use by something else."
    echo "Either stop that, or pick another port:  COZY_PORT=8788 cozy"
    exit 1
  fi
  cd "\$DIR"
  # nohup + closed stdin so the server survives closing Termux and never
  # holds the terminal open. nohup execs directly, so \$! is the real pid.
  nohup "\$PY" -m http.server "\$PORT" --bind "\$BIND" >"\$LOG" 2>&1 </dev/null &
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

stop() {
  if running; then kill "\$(cat "\$PID")" 2>/dev/null || true; fi
  rm -f "\$PID"
}

update() {
  git -C "\$DIR" fetch --quiet origin
  git -C "\$DIR" reset --hard --quiet origin/HEAD 2>/dev/null \\
    || git -C "\$DIR" reset --hard --quiet origin/main
}

open_url() {
  if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "\$URL"
  else echo "Open this in your browser:  \$URL"; fi
}

case "\${1:-run}" in
  run)
    update
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
    grep -o 'COZY CHAT v[0-9.]*' "\$DIR/index.html" 2>/dev/null | head -1
    ;;
  log)     tail -n 40 "\$LOG" 2>/dev/null || echo "No log yet."; ;;
  path)    echo "\$DIR"; ;;
  *)
    echo "cozy            update, serve, and open"
    echo "cozy update     pull the latest without restarting"
    echo "cozy restart    restart the server"
    echo "cozy stop       stop the server"
    echo "cozy status     is it running, and which version"
    echo "cozy log        recent server output"
    echo "cozy path       where the files live"
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
warn "Heads up: a browser keeps separate storage per address, so the local"
warn "copy at http://127.0.0.1:$PORT/ starts empty even if you have chats on"
warn "the github.io version. To bring them over: open the old one, Back up,"
warn "then open the local one and Restore."
