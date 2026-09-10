#!/usr/bin/env python3
"""
Cozy Chat local server.

Plain `python -m http.server` sends Last-Modified and answers conditional
requests with 304, so a browser — or a service worker registered against
127.0.0.1 — can keep showing a copy you already replaced on disk. Then
`cozy` pulls an update, the files change, and the page looks identical.

This serves the same directory but forbids caching outright and ignores
revalidation headers, so every request returns the bytes currently on disk.
"""
import json
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

# The vault: one JSON blob with everything the app has (chats, files,
# settings), written by the app after every change. It lives next to this
# script, on disk — clearing the browser cannot touch it, and the app
# restores itself from it on the next open.
VAULT_PATH = os.path.join(ROOT, "cozy-vault.json")
VAULT_LIMIT = 64 * 1024 * 1024  # 64 MB of JSON is far past any sane vault
_vault_lock = threading.Lock()


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _drop_revalidation(self):
        # Without this the parent class still answers 304 Not Modified and the
        # browser keeps its old copy, which is the whole problem.
        for h in ("If-Modified-Since", "If-None-Match"):
            while h in self.headers:
                del self.headers[h]

    def _is_vault(self):
        return self.path.split("?", 1)[0] == "/api/vault"

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_index(self):
        # The app learns it has a disk copy from this tag — no tag, no probe,
        # so anywhere else it never makes a vault request at all.
        try:
            with open(os.path.join(ROOT, "index.html"), "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        marker = b'<meta name="cozy-vault" content="1">'
        if marker not in body:
            if b"</head>" in body:
                body = body.replace(b"</head>", b"  " + marker + b"\n</head>", 1)
            else:
                body = body + b"\n" + marker + b"\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._drop_revalidation()
        path = self.path.split("?", 1)[0]
        if path == "/" or path == "/index.html":
            self._serve_index()
            return
        if self._is_vault():
            with _vault_lock:
                if not os.path.exists(VAULT_PATH):
                    self._send_json(404, {"error": "no vault yet"})
                    return
                try:
                    with open(VAULT_PATH, "rb") as f:
                        body = f.read()
                except OSError:
                    self._send_json(500, {"error": "vault unreadable"})
                    return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_PUT(self):
        if self._is_vault():
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if length <= 0:
                self._send_json(400, {"error": "empty body"})
                return
            if length > VAULT_LIMIT:
                self._send_json(413, {"error": "vault too large"})
                return
            body = self.rfile.read(length)
            # A body that is not the blob the app sends is a bug, not a
            # smaller vault — it must never overwrite the rescue copy.
            try:
                parsed = json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                self._send_json(400, {"error": "not valid JSON"})
                return
            if not isinstance(parsed, dict) or not isinstance(parsed.get("conversations"), list):
                self._send_json(400, {"error": "not a cozy vault blob"})
                return
            with _vault_lock:
                tmp = VAULT_PATH + ".tmp"
                try:
                    with open(tmp, "wb") as f:
                        f.write(body)
                    os.replace(tmp, VAULT_PATH)
                except OSError:
                    self._send_json(500, {"error": "vault unwritable"})
                    return
            self._send_json(200, {"ok": True, "bytes": len(body)})
            return
        self._send_json(404, {"error": "not found"})

    def do_HEAD(self):
        self._drop_revalidation()
        super().do_HEAD()

    def log_message(self, fmt, *args):
        pass  # keep the log file small; errors still surface


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    bind = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    srv = ThreadingHTTPServer((bind, port), NoCacheHandler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
