"""Smoke tests for the fake 1C.

Run from the repo root:  python -m unittest loadtest.fake_1c.test_server -v
Stdlib only — no uv, no Django.
"""
import json
import socket
import threading
import time
import unittest
import urllib.error
import urllib.request

from loadtest.fake_1c.server import make_server, set_mode


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

    def test_client_disconnect_before_response_does_not_crash_server(self):
        """A client that closes the connection before reading response must
        not cause the server to log exceptions or become unhealthy.

        This reproduces the scenario where hang_30s mode times out client-side
        (15 s read budget) and closes the socket before the server wakes up.
        """
        # Set mode to hang_30s so the server will sleep during response writing
        _post(f"{self.base}/_control", {"mode": "hang_30s"})

        # Send a request and close immediately without waiting for response
        host, port = self.base.split("://")[1].split(":")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.connect((host, int(port)))
            request = b"GET /HS/ConsultWebExchange/GetStockAndPrices HTTP/1.1\r\nHost: localhost\r\nWarehouse: W1\r\n\r\n"
            sock.sendall(request)
            sock.close()  # Close without reading response
        finally:
            try:
                sock.close()
            except:
                pass

        # Give the handler time to wake up from sleep and attempt to write
        time.sleep(31)

        # Reset mode and verify server is still healthy
        set_mode("fast")
        req = urllib.request.Request(
            f"{self.base}/HS/ConsultWebExchange/GetStockAndPrices",
            headers={"Sku": "SKU-1", "Warehouse": "W1", "IsBarcode": "false"},
        )
        body = json.loads(urllib.request.urlopen(req, timeout=10).read())
        self.assertEqual(body["unit"], "pcs")
        self.assertEqual(len(body["stock"]), 1)
