from __future__ import annotations


from core.services.consult_web_exchange import ConsultWebExchangeClient, ConsultWebExchangeError
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from decimal import Decimal
from django.test import TestCase, override_settings
from unittest import mock


@override_settings(FERNET_KEY=_TEST_FERNET_KEY)
class CreateOrderClientTests(TestCase):
    """ConsultWebExchangeClient.create_order — payload shape + real error contract.

    The upstream .docx status table (401–417) is wrong: the live service
    answers 400 (validation) / 404 (lookups) with ``{"success": false,
    "message": "..."}``. The client branches on that envelope, never on the
    documented custom codes.
    """

    def setUp(self):
        self.org = _make_organization()


    @staticmethod
    def _success_body():
        return {
            'success': True,
            'message': 'Customer order created successfully',
            'OrderNumber': '00000000051',
            'OrderDate': '04.06.2026 15:17:15',
            'OrderRef': 'მყიდველის შეკვეთა 00000000051',
            'Items': [
                {'Sku': '000000007126', 'Name': 'GASTRO სამარილე',
                 'Quantity': 2, 'Price': 15.5, 'Amount': 29.45},
            ],
        }

    @staticmethod
    def _mock_response(status_code, body=None, text=''):
        resp = mock.Mock()
        resp.status_code = status_code
        if body is not None:
            resp.json.return_value = body
            resp.text = str(body)
        else:
            resp.json.side_effect = ValueError('no json body')
            resp.text = text
        resp.reason_phrase = ''
        return resp

    @staticmethod
    def _items():
        return [{
            'is_barcode': False,
            'sku': 'A-100',
            'quantity': 2,
            'price': Decimal('15.50'),
            'cost': Decimal('31.00'),
            'discount': Decimal('5'),
        }]

    def _call(self, response, **overrides):
        client = ConsultWebExchangeClient(self.org)
        kwargs = dict(
            client_id_phone='204433265',
            user_id='administrator',
            stock_id='000000001',
            comment='Web order #7',
            items=self._items(),
        )
        kwargs.update(overrides)
        captured: dict = {}

        def fake_request(method, url, **rkwargs):
            captured['method'] = method
            captured['url'] = url
            captured['json'] = rkwargs.get('json')
            return response

        with mock.patch('httpx.request', side_effect=fake_request):
            result = client.create_order(**kwargs)
        return result, captured

    def test_create_order_posts_documented_payload_shape(self):
        _, captured = self._call(self._mock_response(200, self._success_body()))

        self.assertEqual(captured['method'], 'POST')
        self.assertTrue(captured['url'].endswith('/HS/ConsultWebExchange/CreateOrder'))
        self.assertEqual(
            captured['json'],
            {
                'ClientIDPhone': '204433265',
                'UserID': 'administrator',
                'StockID': '000000001',
                'Comment': 'Web order #7',
                'Items': [{
                    'IsBarcode': 'false',
                    'Sku': 'A-100',
                    'Quantity': 2,
                    'Price': 15.5,
                    'Cost': 31.0,
                    'Discount': 5.0,
                }],
            },
        )
        # Decimals must be converted — stdlib json cannot serialize Decimal.
        item = captured['json']['Items'][0]
        for key in ('Price', 'Cost', 'Discount'):
            self.assertIsInstance(item[key], float)

    def test_create_order_serializes_is_barcode_true_as_string(self):
        items = self._items()
        items[0]['is_barcode'] = True
        items[0]['sku'] = '2000000078649'
        _, captured = self._call(
            self._mock_response(200, self._success_body()), items=items,
        )
        self.assertEqual(captured['json']['Items'][0]['IsBarcode'], 'true')
        self.assertEqual(captured['json']['Items'][0]['Sku'], '2000000078649')

    def test_create_order_omits_blank_comment(self):
        _, captured = self._call(
            self._mock_response(200, self._success_body()), comment='',
        )
        self.assertNotIn('Comment', captured['json'])

    def test_create_order_returns_upstream_body_on_success(self):
        result, _ = self._call(self._mock_response(200, self._success_body()))
        self.assertEqual(result['OrderNumber'], '00000000051')
        self.assertTrue(result['success'])

    def test_create_order_omits_blank_client_id_phone(self):
        # Blank = intentional retail sale: the key is omitted entirely (the
        # variant verified against the live test base 2026-08-04) and 1C
        # creates the order with no client attached.
        for blank in ('', None):
            result, captured = self._call(
                self._mock_response(200, self._success_body()),
                client_id_phone=blank,
            )
            self.assertNotIn('ClientIDPhone', captured['json'])
            self.assertEqual(result['OrderNumber'], '00000000051')

    def test_create_order_maps_400_rejection_with_upstream_message(self):
        body = {'success': False, 'message': 'Items array is empty'}
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            self._call(self._mock_response(400, body))
        self.assertEqual(ctx.exception.code, 'ORDER_CREATE_REJECTED')
        self.assertEqual(ctx.exception.http_status, 400)
        self.assertIn('Items array is empty', ctx.exception.detail)

    def test_create_order_maps_404_lookup_failure_with_upstream_message(self):
        body = {'success': False, 'message': 'Customer not found by ClientIDPhone: 204433265'}
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            self._call(self._mock_response(404, body))
        self.assertEqual(ctx.exception.code, 'ORDER_CREATE_REJECTED')
        self.assertEqual(ctx.exception.http_status, 400)
        self.assertIn('Customer not found', ctx.exception.detail)

    def test_create_order_rejects_success_false_in_200_body(self):
        body = {'success': False, 'message': 'Something went sideways'}
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            self._call(self._mock_response(200, body))
        self.assertEqual(ctx.exception.code, 'ORDER_CREATE_REJECTED')
        self.assertIn('Something went sideways', ctx.exception.detail)

    def test_create_order_maps_401_to_unauthorized(self):
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            self._call(self._mock_response(401))
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_UNAUTHORIZED')

    def test_create_order_maps_unexpected_status_to_external_error(self):
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            self._call(self._mock_response(500, text='IIS error page'))
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_ERROR')
        self.assertEqual(ctx.exception.http_status, 502)
