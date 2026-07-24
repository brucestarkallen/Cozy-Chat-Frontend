#!/data/data/com.termux/files/usr/bin/bash
# Run Cozy Chat locally on your phone.
#   pkg install python
#   bash serve.sh
PORT="${1:-8080}"
cd "$(dirname "$0")" || exit 1
echo ""
echo "  Cozy Chat is running."
echo "  Open this in Chrome:  http://localhost:$PORT"
echo "  Stop it with Ctrl+C."
echo ""
python -m http.server "$PORT" --bind 127.0.0.1
