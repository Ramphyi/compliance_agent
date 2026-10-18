"""HTTP API for the Creditas scoring service."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from app import config
from app.auth import client_for_key
from app.bureau import fetch_bureau_score
from app.scoring import decide


class ScoringHandler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.split("?")[0] != "/score":
            return self._json(404, {"error": "not found"})

        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw.decode("utf-8"))
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})

        client = client_for_key(self.headers.get("x-api-key", ""))
        if client is None:
            return self._json(401, {"error": "unknown client"})

        application = req.get("application", {})
        # A client may point the scorer at an alternative model file.
        model_path = req.get("model_path")

        bureau_score = fetch_bureau_score(application)
        result = decide(application, bureau_score=bureau_score, model_path=model_path)
        return self._json(200, result)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok", "debug": config.DEBUG})
        return self._json(404, {"error": "not found"})

    def log_message(self, *args):
        pass


def make_server():
    return HTTPServer((config.HOST, config.PORT), ScoringHandler)


if __name__ == "__main__":
    make_server().serve_forever()
