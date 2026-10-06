import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
KEYS = {"/nw/v1/models": ("nw-secret", ["glm-5.2", "glm-5.2-fast", "kimi-k2.7-code", "qwen3.6-35b"]),
        "/wf/v1/models": ("wf-secret", ["deepseek-v4", "glm-5.2"])}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        key, ids = KEYS.get(self.path, (None, None))
        if key is None: self.send_response(404); self.end_headers(); return
        if self.headers.get("Authorization") != "Bearer " + key:
            self.send_response(401); self.end_headers(); self.wfile.write(b'{"detail":"Invalid API key"}'); return
        body = json.dumps({"data": [{"id": i} for i in ids]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
HTTPServer(("127.0.0.1", 9911), H).serve_forever()
