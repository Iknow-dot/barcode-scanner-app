from __future__ import annotations

import os

from core.services.consult_web_exchange import ConsultWebExchangeClient, ConsultWebExchangeError
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from django.test import TestCase
from unittest import mock


class GetStockAndPricesStatusTests(TestCase):
    """201 means 'found, but out of stock' — it must not read as 'not found'."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _mock_response(self, status_code: int, body: object = None, json_raises: bool = False):
        resp = mock.Mock()
        resp.status_code = status_code
        if json_raises:
            resp.json.side_effect = ValueError('not json')
        else:
            resp.json.return_value = body if body is not None else {}
        resp.text = '' if body is None else str(body)
        return resp

    def test_201_no_stock_returns_product_with_empty_stock(self):
        client = ConsultWebExchangeClient(self.org)
        body = {'sku': '000000012699', 'sku_name': 'CRAZY ჭიქები',
                'article': 'B25250060', 'unit': 'ცალი', 'stock': []}
        with mock.patch('httpx.request', return_value=self._mock_response(201, body)):
            result = client.get_stock_and_prices('X', is_barcode=True, warehouses='')
        self.assertEqual(result['sku_name'], 'CRAZY ჭიქები')
        self.assertEqual(result['stock'], [])

    def test_201_defaults_missing_stock_key_to_empty_list(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch(
            'httpx.request',
            return_value=self._mock_response(201, {'sku': 'S1', 'sku_name': 'N'}),
        ):
            result = client.get_stock_and_prices('S1', is_barcode=False, warehouses='')
        self.assertEqual(result['stock'], [])

    def test_201_with_unparseable_body_returns_empty_stock(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch(
            'httpx.request',
            return_value=self._mock_response(201, json_raises=True),
        ):
            result = client.get_stock_and_prices('S1', is_barcode=False, warehouses='')
        self.assertEqual(result, {'stock': []})

    def test_421_still_raises_product_not_found(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch('httpx.request', return_value=self._mock_response(421)):
            with self.assertRaises(ConsultWebExchangeError) as ctx:
                client.get_stock_and_prices('X', is_barcode=True, warehouses='')
        self.assertEqual(ctx.exception.code, 'PRODUCT_NOT_FOUND')
        self.assertEqual(ctx.exception.upstream_status, 421)

    def test_200_still_returns_body(self):
        client = ConsultWebExchangeClient(self.org)
        body = {'sku': 'S1', 'stock': [{'warehouse': 'W1', 'quantity': 3}]}
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.get_stock_and_prices('S1', is_barcode=False, warehouses='')
        self.assertEqual(result, body)


class GetStockAndPricesUpstreamErrorTests(TestCase):
    """Only a genuine "nomenclature not found" is PRODUCT_NOT_FOUND. Any other
    upstream failure is an external-service error — reporting a 422 or a 500 as
    "product not found" hides a broken integration behind a shrug."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _raise_for(self, status_code):
        client = ConsultWebExchangeClient(self.org)
        resp = mock.Mock()
        resp.status_code = status_code
        resp.json.return_value = {}
        resp.text = ''
        with mock.patch('httpx.request', return_value=resp):
            with self.assertRaises(ConsultWebExchangeError) as ctx:
                client.get_stock_and_prices('X', is_barcode=True, warehouses='')
        return ctx.exception

    def test_421_is_product_not_found(self):
        exc = self._raise_for(421)
        self.assertEqual(exc.code, 'PRODUCT_NOT_FOUND')
        self.assertEqual(exc.http_status, 404)

    def test_404_is_product_not_found(self):
        exc = self._raise_for(404)
        self.assertEqual(exc.code, 'PRODUCT_NOT_FOUND')
        self.assertEqual(exc.http_status, 404)

    def test_422_is_an_external_service_error(self):
        exc = self._raise_for(422)
        self.assertEqual(exc.code, 'EXTERNAL_SERVICE_ERROR')
        self.assertEqual(exc.http_status, 502)
        self.assertEqual(exc.upstream_status, 422)

    def test_500_is_an_external_service_error(self):
        # A wrong publication name on the 1C host answers 500 with
        # "ინფორმაციული ბაზა ..." — a misconfiguration, not a missing product.
        exc = self._raise_for(500)
        self.assertEqual(exc.code, 'EXTERNAL_SERVICE_ERROR')
        self.assertEqual(exc.http_status, 502)
