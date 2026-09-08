"""Smoke tests for the fake 1C.

Run from the repo root:  python -m unittest loadtest.fake_1c.test_server -v
Stdlib only — no uv, no Django.
"""
import contextlib
import io
import json
import threading
import unittest
import urllib.error
import urllib.request

from loadtest.fake_1c.server import make_server, set_mode, Handler


def _post(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    return urllib.request.urlopen(req, timeout=10)


class FakeOneCTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server(0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        set_mode("fast")

    def test_stock_echoes_requested_warehouses(self):
        req = urllib.request.Request(
            f"{self.base}/HS/ConsultWebExchange/GetStockAndPrices",
            headers={"Sku": "SKU-1", "Warehouse": "W1,W2", "IsBarcode": "false"},
        )
        body = json.loads(urllib.request.urlopen(req, timeout=10).read())
        self.assertEqual([r["warehouse"] for r in body["stock"]], ["W1", "W2"])
        self.assertEqual(body["unit"], "pcs")

    def test_create_order_returns_a_unique_order_number(self):
        first = json.loads(_post(f"{self.base}/HS/ConsultWebExchange/CreateOrder", {}).read())
        second = json.loads(_post(f"{self.base}/HS/ConsultWebExchange/CreateOrder", {}).read())
        self.assertNotEqual(first["OrderNumber"], second["OrderNumber"])

    def test_check_client_returns_a_one_element_list(self):
        body = json.loads(
            _post(f"{self.base}/HS/ConsultWebExchange/CheckClient", {"IDPhone": "555"}).read()
        )
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["Phone"], "555")

    def test_create_client_answers_204_with_no_body(self):
        resp = _post(f"{self.base}/HS/ConsultWebExchange/CreateClient", {"Name": "x"})
        self.assertEqual(resp.status, 204)
        self.assertEqual(resp.read(), b"")

    def test_control_switches_mode_and_rejects_unknown_modes(self):
        resp = _post(f"{self.base}/_control", {"mode": "http_500"})
        self.assertEqual(json.loads(resp.read())["mode"], "http_500")
        req = urllib.request.Request(
            f"{self.base}/HS/ConsultWebExchange/GetStockAndPrices",
            headers={"Sku": "SKU-1", "Warehouse": "W1", "IsBarcode": "false"},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(caught.exception.code, 500)

        with self.assertRaises(urllib.error.HTTPError) as caught:
            _post(f"{self.base}/_control", {"mode": "nonsense"})
        self.assertEqual(caught.exception.code, 400)

    def test_421_mode_is_the_not_found_signal(self):
        _post(f"{self.base}/_control", {"mode": "421_not_found"})
        req = urllib.request.Request(
            f"{self.base}/HS/ConsultWebExchange/GetStockAndPrices",
            headers={"Sku": "SKU-1", "Warehouse": "W1", "IsBarcode": "false"},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(caught.exception.code, 421)

    def test_send_json_suppresses_connection_errors_silently(self):
        """Connection errors during response write must not log tracebacks.

        When a client disconnects before reading the response (e.g., timeout),
        _send_json must catch the error and not output anything to stderr.
        This test verifies the error is suppressed by checking stderr is clean.
        """
        # Create a mock wfile that raises ConnectionAbortedError on write()
        class FailingWFile:
            def write(self, data):
                raise ConnectionAbortedError("simulated client disconnect")

        # Create a mock handler with no real socket
        class MockHandler:
            def __init__(self):
                self.wfile = FailingWFile()
                self._headers_sent = False

            def send_response(self, status):
                self._status = status

            def send_header(self, key, value):
                pass

            def end_headers(self):
                self._headers_sent = True

        # Capture stderr while calling the real _send_json method
        handler = MockHandler()
        stderr_capture = io.StringIO()
        with contextlib.redirect_stderr(stderr_capture):
            # Bind the real _send_json to the mock handler and call it
            Handler._send_json(handler, 200, {"test": "data"})

        # Assert nothing was written to stderr (the fix suppresses the error)
        stderr_output = stderr_capture.getvalue()
        self.assertEqual(stderr_output, "", f"Expected clean stderr but got: {stderr_output}")

    def test_send_no_content_suppresses_connection_errors_silently(self):
        """Connection errors during no-content response must not log tracebacks.

        When a client disconnects before reading the 204 response,
        _send_no_content must catch the error and not output anything to stderr.

        This test exercises the REAL BaseHTTPRequestHandler.send_response()
        and end_headers() methods, which interact with wfile and buffers.
        """
        # Create a failing wfile that raises ConnectionAbortedError on write()
        class FailingWFile:
            def write(self, data):
                raise ConnectionAbortedError("simulated client disconnect")

        # Create a real Handler instance (without calling __init__)
        handler = Handler.__new__(Handler)

        # Set up the attributes that send_response and end_headers actually use
        handler.wfile = FailingWFile()
        handler.request_version = "HTTP/1.1"
        handler.requestline = "GET / HTTP/1.1"  # Required by log_request()
        handler._headers_buffer = []  # BaseHTTPRequestHandler uses this buffer
        handler.client_address = ("127.0.0.1", 12345)  # For potential logging

        # Capture stderr while calling _send_no_content with real stdlib path
        stderr_capture = io.StringIO()
        with contextlib.redirect_stderr(stderr_capture):
            handler._send_no_content()

        # Assert nothing was written to stderr (the fix suppresses the error)
        stderr_output = stderr_capture.getvalue()
        self.assertEqual(stderr_output, "", f"Expected clean stderr but got: {stderr_output}")
