#!/data/data/com.termux/files/usr/bin/bash
# Run Cozy Chat locally on your phone.
#   pkg install python
#   bash serve.sh
# the port cozy uses: one address for the app and its data, however it is started
PORT="${1:-8787}"
cd "$(dirname "$0")" || exit 1
echo ""
echo "  Cozy Chat is running."
echo "  Open this in Chrome:  http://localhost:$PORT"
echo "  Stop it with Ctrl+C."
echo ""
# serve.py, not a plain file server: it keeps the chats on this phone in
# ~/.cozychat and never lets a browser keep an old copy of the app. A plain
# `python -m http.server` here left every chat in the browser - the opposite
# of what the README promises for the copy served from Termux.
PY=$(command -v python3 || command -v python)
exec "$PY" serve.py "$PORT" 127.0.0.1
