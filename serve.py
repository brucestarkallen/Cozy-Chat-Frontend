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
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


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

    def do_GET(self):
        self._drop_revalidation()
        super().do_GET()

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
