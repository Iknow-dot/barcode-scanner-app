"""Controllable stand-in for the per-org 1C ConsultWebExchange service.

Mirrors backend/core/services/consult_web_exchange.py: four operations under
/HS/ConsultWebExchange/, and the Sku / Warehouse / IsBarcode headers that
GetStockAndPrices reads. A POST to /_control switches behaviour mid-run, which
is the only way to reproduce a slow or broken 1C on demand.

ThreadingHTTPServer, never HTTPServer: a single-threaded server wedges on
client preconnects and every later request hangs.
"""
from __future__ import annotations

import itertools
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PREFIX = "/HS/ConsultWebExchange/"

MODES = frozenset({
    "fast",           # answer immediately
    "slow_5s",        # inside the client's 15 s read budget
    "hang_30s",       # past the read budget, well under the 60 s router cutoff
    "http_500",       # upstream broken
    "refuse",         # drop the connection without answering
    "421_not_found",  # 1C's "nomenclature not found"
    "201_no_stock",   # found, but no stock at the requested warehouses
})

_lock = threading.Lock()
_mode = "fast"
_order_numbers = itertools.count(1)


def set_mode(mode: str) -> None:
    global _mode
    with _lock:
        _mode = mode


def get_mode() -> str:
    with _lock:
        return _mode


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        """Silence per-request logging; a load test would drown the console."""

    def handle(self):
        """Override handle to suppress connection errors from client disconnects."""
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Client disconnected before completing request/response cycle
            pass

    # -- wire helpers -----------------------------------------------------

    def _send_json(self, status: int, body: object) -> None:
        payload = json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Client disconnected before receiving response (e.g., timeout, network issue)
            pass

    def _send_no_content(self) -> None:
        try:
            self.send_response(204)
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Client disconnected before receiving response
            pass

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            parsed = json.loads(self.rfile.read(length))
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _endpoint_name(self) -> str | None:
        if not self.path.startswith(PREFIX):
            return None
        return self.path[len(PREFIX):].split("?")[0]

    def _mode_answered(self) -> bool:
        """Apply the current mode. True means the request is already answered."""
        mode = get_mode()
        if mode == "slow_5s":
            time.sleep(5)
        elif mode == "hang_30s":
            time.sleep(30)
        elif mode == "refuse":
            self.close_connection = True
            self.connection.close()
            return True
        elif mode == "http_500":
            self._send_json(500, {"error": "fake 1C failure"})
            return True
        elif mode == "421_not_found":
            self._send_json(421, {"error": "nomenclature not found"})
            return True
        elif mode == "201_no_stock":
            self._send_json(201, {})
            return True
        return False

    # -- routes -----------------------------------------------------------

    def do_GET(self):
        name = self._endpoint_name()
        if name != "GetStockAndPrices":
            self._send_json(404, {"error": "unknown endpoint"})
            return
        if self._mode_answered():
            return
        warehouses = [w for w in (self.headers.get("Warehouse") or "").split(",") if w]
        self._send_json(200, {
            "unit": "pcs",
            "stock": [
                # warehouse_name is required, not decorative: ProductSearchSerializer's
                # StockSerializer (backend/core/serializers/products.py) declares it a
                # plain CharField with no default, so a row missing it 500s
                # ProductSearchAPIView with a KeyError while rendering the response.
                # This was masked for a long time by a load-test client bug that always
                # sent an empty Warehouse header, so `stock` was always `[]` and this
                # branch never ran with a real row.
                {"warehouse": code, "warehouse_name": f"Warehouse {code}", "quantity": 100, "price": "9.90"}
                for code in warehouses
            ],
        })

    def do_POST(self):
        if self.path == "/_control":
            mode = self._read_body().get("mode", "fast")
            if mode not in MODES:
                self._send_json(400, {"error": "unknown mode", "modes": sorted(MODES)})
                return
            set_mode(mode)
            self._send_json(200, {"mode": mode})
            return

        name = self._endpoint_name()
        body = self._read_body()
        if name not in ("CheckClient", "CreateClient", "CreateOrder"):
            self._send_json(404, {"error": "unknown endpoint"})
            return
        if self._mode_answered():
            return

        if name == "CheckClient":
            id_phone = str(body.get("IDPhone") or "")
            self._send_json(200, [{
                "ClientID": f"lt-client-{id_phone}",
                "Name": "Load Test Client",
                "Phone": id_phone,
            }])
        elif name == "CreateClient":
            # Any 2xx means created; the real upstream answers 204 with no body.
            self._send_no_content()
        else:  # CreateOrder
            with _lock:
                number = next(_order_numbers)
            self._send_json(200, {"OrderNumber": f"LT-{number:07d}"})


def make_server(port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    return server


if __name__ == "__main__":
    make_server(int(os.environ.get("PORT", "8099"))).serve_forever()
