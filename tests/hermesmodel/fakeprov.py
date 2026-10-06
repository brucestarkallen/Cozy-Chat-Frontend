import json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
def make(key, ids):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _auth(self):
            if self.headers.get("Authorization") != "Bearer " + key:
                self.send_response(401); self.send_header("Content-Type","application/json"); self.end_headers()
                self.wfile.write(b'{"detail":"Invalid API key"}'); return False
            return True
        def do_GET(self):
            if not self._auth(): return
            body = json.dumps({"data": [{"id": i} for i in ids]}).encode()
            self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers(); self.wfile.write(body)
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); req = json.loads(self.rfile.read(n) or b"{}")
            if not self._auth(): return
            if req.get("model") not in ids:
                self.send_response(404); self.end_headers(); self.wfile.write(b'{"detail":"no such model"}'); return
            body = json.dumps({"choices":[{"message":{"role":"assistant","content":"ok"}}]}).encode()
            self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers(); self.wfile.write(body)
    return H
for port, key, ids in ((9911, "nw-secret", ["glm-5.2","glm-5.2-fast","kimi-k2.7-code"]), (9912, "wf-secret", ["deepseek-v4","glm-5.2"])):
    s = ThreadingHTTPServer(("127.0.0.1", port), make(key, ids)); threading.Thread(target=s.serve_forever, daemon=True).start()
threading.Event().wait()
