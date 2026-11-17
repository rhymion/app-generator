"""A deliberately broken stand-in for a generated app.

It has every defect the Nuclei templates in ``templates/`` look for, so
``check_templates_fire.sh`` can show that each template matches.
"""

import http.server
import json
import sys

CHUNK = "/_next/static/chunks/app.js"


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, status, body, content_type="application/json", headers=None):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802 - http.server naming
        path = self.path.split("?")[0]
        if path == "/":
            self._send(200, f'<html><script src="{CHUNK}"></script></html>', "text/html")
        elif path == "/api/auth/csrf":
            # No security headers, and X-Powered-By is present.
            self._send(200, json.dumps({"csrfToken": "x"}), headers={"X-Powered-By": "Next.js"})
        elif path in ("/api/openapi.json", "/api/audit_log", "/api/notifications", "/api/approval_request"):
            self._send(200, json.dumps({"data": []}))
        elif path == "/.env":
            self._send(200, "AUTH_SECRET=x\n", "text/plain")
        elif path == "/.git/config":
            self._send(200, "[core]\n", "text/plain")
        elif path == CHUNK + ".map":
            self._send(200, json.dumps({"version": 3, "mappings": "AAAA"}))
        else:
            self._send(404, "{}")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1])
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
