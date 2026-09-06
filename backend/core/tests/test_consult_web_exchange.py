from __future__ import annotations

import os

from core.serializers import OrganizationExternalServiceSerializer, ProductSearchSerializer
from core.services.consult_web_exchange import ConsultWebExchangeClient, ConsultWebExchangeError, _normalize_client_response
from decimal import Decimal
from django.test import TestCase, override_settings
from unittest import mock
from core.tests.common import _TEST_FERNET_KEY, _make_organization


@override_settings()
class ConsultWebExchangeClientUrlTests(TestCase):
    def setUp(self):
        self.org = _make_organization()

    def test_endpoint_url_appends_path_prefix(self):
        client = ConsultWebExchangeClient(self.org)
        self.assertEqual(
            client.endpoint_url('CheckClient'),
            'http://example.com/db/HS/ConsultWebExchange/CheckClient',
        )

    def test_endpoint_url_handles_trailing_slash(self):
        self.org.web_service_url = 'http://example.com/db/'
        client = ConsultWebExchangeClient(self.org)
        self.assertEqual(
            client.endpoint_url('GetStockAndPrices'),
            'http://example.com/db/HS/ConsultWebExchange/GetStockAndPrices',
        )

    def test_endpoint_url_handles_multiple_trailing_slashes(self):
        self.org.web_service_url = 'http://example.com/db///'
        client = ConsultWebExchangeClient(self.org)
        self.assertEqual(
            client.endpoint_url('CreateClient'),
            'http://example.com/db/HS/ConsultWebExchange/CreateClient',
        )

    def test_endpoint_url_raises_on_blank_base(self):
        self.org.web_service_url = ''
        client = ConsultWebExchangeClient(self.org)
        with self.assertRaises(ConsultWebExchangeError) as ctx:
            client.endpoint_url('CheckClient')
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_ERROR')


class ConsultWebExchangeAuthTests(TestCase):
    def setUp(self):
        self.org = _make_organization(web_service_username='alice')
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org.encrypt_password('s3cret')
        self.org.save()

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def test_auth_returns_basic_credentials(self):
        client = ConsultWebExchangeClient(self.org)
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.assertEqual(client._auth(), ('alice', 's3cret'))

    def test_auth_returns_none_when_no_username(self):
        self.org.web_service_username = ''
        client = ConsultWebExchangeClient(self.org)
        self.assertIsNone(client._auth())


class CheckClientResultTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _mock_response(self, status_code: int, body: object = None, reason: str = ''):
        resp = mock.Mock()
        resp.status_code = status_code
        resp.json.return_value = body if body is not None else {}
        resp.text = '' if body is None else str(body)
        resp.reason_phrase = reason
        return resp

    def test_check_client_returns_none_on_upstream_404(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch('httpx.request', return_value=self._mock_response(404)):
            self.assertIsNone(
                client.check_client(identification_number='12345678901')
            )

    def test_check_client_returns_none_on_400_not_found_reason(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch(
            'httpx.request',
            return_value=self._mock_response(400, reason='not_found'),
        ):
            self.assertIsNone(
                client.check_client(identification_number='12345678901')
            )

    def test_check_client_returns_none_on_400_not_found_body(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch(
            'httpx.request',
            return_value=self._mock_response(400, {'status': 'not_found'}),
        ):
            self.assertIsNone(
                client.check_client(identification_number='12345678901')
            )

    def test_check_client_returns_normalized_list_on_200_unwrapped(self):
        client = ConsultWebExchangeClient(self.org)
        body = {
            'name': 'Nino Beridze',
            'address': 'Tbilisi, Pekini Ave 12',
            'phone': '+995555000111',
        }
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.check_client(identification_number='12345678901')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['name'], 'Nino Beridze')
        self.assertEqual(result[0]['address'], 'Tbilisi, Pekini Ave 12')
        self.assertEqual(result[0]['phone'], '+995555000111')
        self.assertEqual(result[0]['raw'], body)

    def test_check_client_prefers_phone_1_over_legacy_phone(self):
        # 1C bug fix: when the response carries phone_1 (main phone) alongside
        # the legacy `phone` field (which 1C populated from phone_2), the main
        # phone must win.
        client = ConsultWebExchangeClient(self.org)
        body = {
            'name': 'Nino Beridze',
            'phone': '+995500000002',    # legacy field == additional phone
            'phone_1': '+995500000001',  # main phone
            'phone_2': '+995500000002',
        }
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.check_client(identification_number='12345678901')
        self.assertEqual(result[0]['phone'], '+995500000001')

    def test_check_client_falls_back_to_legacy_phone_when_no_phone_1(self):
        # No regression: responses that only carry `phone` still map it.
        client = ConsultWebExchangeClient(self.org)
        body = {'name': 'Nino Beridze', 'phone': '+995500000111'}
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.check_client(identification_number='12345678901')
        self.assertEqual(result[0]['phone'], '+995500000111')

    def test_check_client_ignores_empty_phone_1_and_uses_phone(self):
        # If phone_1 comes back blank, fall back to the legacy phone field.
        client = ConsultWebExchangeClient(self.org)
        body = {'name': 'Nino Beridze', 'phone': '+995500000111', 'phone_1': ''}
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.check_client(identification_number='12345678901')
        self.assertEqual(result[0]['phone'], '+995500000111')

    def test_check_client_unwraps_customer_wrapper(self):
        client = ConsultWebExchangeClient(self.org)
        body = {
            'status': 'found',
            'customer': {
                'name': 'Giorgi Beridze',
                'address': 'Batumi',
                'phone': '+995555',
            },
        }
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.check_client(identification_number='01001012345')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['name'], 'Giorgi Beridze')
        self.assertEqual(result[0]['address'], 'Batumi')
        self.assertEqual(result[0]['phone'], '+995555')

    def test_check_client_returns_multiple_matches(self):
        client = ConsultWebExchangeClient(self.org)
        body = {
            'status': 'found',
            'clients': [
                {'name': 'A One', 'address': 'Tbilisi', 'phone': '+995111'},
                {'name': 'A Two', 'address': 'Batumi', 'phone': '+995222'},
            ],
        }
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.check_client(identification_number='01001012345')
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['name'], 'A One')
        self.assertEqual(result[1]['name'], 'A Two')

    def test_check_client_returns_top_level_list(self):
        client = ConsultWebExchangeClient(self.org)
        body = [
            {'name': 'A', 'phone': '+995111'},
            {'name': 'B', 'phone': '+995222'},
        ]
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            result = client.check_client(identification_number='01001012345')
        self.assertEqual(len(result), 2)

    def test_check_client_returns_none_on_status_not_found(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch('httpx.request', return_value=self._mock_response(200, {'status': 'not_found'})):
            self.assertIsNone(client.check_client(phone='+995555000111'))

    def test_check_client_returns_none_on_empty_customer_wrapper(self):
        client = ConsultWebExchangeClient(self.org)
        body = {'status': 'not_found', 'customer': None}
        with mock.patch('httpx.request', return_value=self._mock_response(200, body)):
            self.assertIsNone(client.check_client(phone='+995555000111'))

    def test_check_client_request_uses_idphone_with_id_priority(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        def fake_request(method, url, **kwargs):
            captured['json'] = kwargs.get('json')
            resp = mock.Mock()
            resp.status_code = 200
            resp.json.return_value = {'status': 'not_found'}
            resp.text = ''
            return resp

        with mock.patch('httpx.request', side_effect=fake_request):
            client.check_client(identification_number='01001012345', phone='+995555')

        # Upstream takes a single `IDPhone` field; identification_number wins
        # when both are provided.
        self.assertEqual(captured['json'], {'IDPhone': '01001012345'})

    def test_check_client_raises_on_unauthorized(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch('httpx.request', return_value=self._mock_response(401)):
            with self.assertRaises(ConsultWebExchangeError) as ctx:
                client.check_client(identification_number='1')
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_UNAUTHORIZED')
        self.assertEqual(ctx.exception.http_status, 502)

    def test_check_client_raises_on_unexpected_status(self):
        client = ConsultWebExchangeClient(self.org)
        with mock.patch('httpx.request', return_value=self._mock_response(500)):
            with self.assertRaises(ConsultWebExchangeError) as ctx:
                client.check_client(phone='+995555000111')
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_ERROR')
        self.assertEqual(ctx.exception.upstream_status, 500)

    def test_check_client_requires_at_least_one_lookup_key(self):
        client = ConsultWebExchangeClient(self.org)
        with self.assertRaises(ValueError):
            client.check_client()


class CreateClientPayloadMappingTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _fake_request(self, captured: dict):
        def _inner(method, url, **kwargs):
            captured['method'] = method
            captured['url'] = url
            captured['json'] = kwargs.get('json')
            resp = mock.Mock()
            resp.status_code = 201
            resp.json.return_value = {'status': 'created', 'customer': {}}
            resp.text = ''
            return resp
        return _inner

    def test_create_client_maps_internal_fields_to_upstream(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        def fake_request(method, url, **kwargs):
            captured['method'] = method
            captured['url'] = url
            captured['json'] = kwargs.get('json')
            resp = mock.Mock()
            resp.status_code = 201
            resp.json.return_value = {
                'status': 'created',
                'customer': {
                    'name': 'Giorgi Beridze',
                    'address': 'Tbilisi',
                    'phone': '+995555',
                },
            }
            resp.text = ''
            return resp

        with mock.patch('httpx.request', side_effect=fake_request):
            result = client.create_client({
                'first_name': 'Giorgi',
                'last_name': 'Beridze',
                'identification_number': '01001012345',
                'is_phys': True,
                'phone': '+995555',
                'email': '',  # blank — should be dropped
            })

        self.assertEqual(captured['method'], 'POST')
        self.assertTrue(captured['url'].endswith('/HS/ConsultWebExchange/CreateClient'))
        self.assertEqual(
            captured['json'],
            {
                'IsPhys': True,
                'first_name': 'Giorgi',
                'last_name': 'Beridze',
                'personal_number': '01001012345',
                'phone_1': '+995555',
            },
        )
        # `create_client` returns the raw upstream JSON; normalization
        # happens in the view layer.
        self.assertEqual(
            result,
            {
                'status': 'created',
                'customer': {
                    'name': 'Giorgi Beridze',
                    'address': 'Tbilisi',
                    'phone': '+995555',
                },
            },
        )

    def test_create_client_sends_flat_address_line(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        with mock.patch('httpx.request', side_effect=self._fake_request(captured)):
            client.create_client({
                'first_name': 'A',
                'last_name': 'B',
                'address_line': 'Pekini Ave 12',
            })

        self.assertEqual(captured['json'], {
            'IsPhys': True,
            'first_name': 'A',
            'last_name': 'B',
            'address_line': 'Pekini Ave 12',
        })
        # Address must NOT be nested.
        self.assertNotIsInstance(captured['json'].get('address_line'), dict)
        self.assertNotIn('address', captured['json'])

    def test_create_client_omits_address_line_when_blank(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        with mock.patch('httpx.request', side_effect=self._fake_request(captured)):
            client.create_client({'first_name': 'A', 'last_name': 'B'})

        self.assertNotIn('address_line', captured['json'])
        self.assertNotIn('address', captured['json'])

    def test_create_client_includes_phone_2_when_provided(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        with mock.patch('httpx.request', side_effect=self._fake_request(captured)):
            client.create_client({
                'first_name': 'A', 'last_name': 'B',
                'phone': '+995555', 'phone_2': '+995777',
            })

        self.assertEqual(captured['json']['phone_1'], '+995555')
        self.assertEqual(captured['json']['phone_2'], '+995777')

    def test_create_client_sends_is_phys_default_true(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        with mock.patch('httpx.request', side_effect=self._fake_request(captured)):
            client.create_client({'first_name': 'A', 'last_name': 'B'})

        # Even without is_phys in payload, the upstream gets IsPhys=True.
        self.assertIs(captured['json']['IsPhys'], True)

    def test_create_client_sends_is_phys_false_when_legal_entity(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        with mock.patch('httpx.request', side_effect=self._fake_request(captured)):
            client.create_client({
                'first_name': 'Acme',
                'last_name': 'Ltd',
                'is_phys': False,
            })

        self.assertIs(captured['json']['IsPhys'], False)

    def test_create_client_sends_email_with_capital_key(self):
        client = ConsultWebExchangeClient(self.org)
        captured: dict = {}

        with mock.patch('httpx.request', side_effect=self._fake_request(captured)):
            client.create_client({
                'first_name': 'A', 'last_name': 'B',
                'email': 'a@b.com',
            })

        # 1C field name is `Email` (capitalized).
        self.assertEqual(captured['json']['Email'], 'a@b.com')
        self.assertNotIn('email', captured['json'])

    def test_create_client_raises_on_409(self):
        client = ConsultWebExchangeClient(self.org)
        resp = mock.Mock()
        resp.status_code = 409
        resp.json.return_value = {}
        resp.text = ''
        with mock.patch('httpx.request', return_value=resp):
            with self.assertRaises(ConsultWebExchangeError) as ctx:
                client.create_client({'first_name': 'A', 'last_name': 'B'})
        self.assertEqual(ctx.exception.code, 'CLIENT_ALREADY_EXISTS')
        self.assertEqual(ctx.exception.http_status, 409)


class NormalizeClientResponseTests(TestCase):
    def test_unwraps_customer_wrapper(self):
        body = {
            'status': 'found',
            'customer': {'name': 'A B', 'address': 'Tbilisi', 'phone': '+995'},
        }
        result = _normalize_client_response(body)
        self.assertEqual(result['name'], 'A B')
        self.assertEqual(result['address'], 'Tbilisi')
        self.assertEqual(result['phone'], '+995')

    def test_passes_through_unwrapped_dict(self):
        body = {'name': 'A B', 'address': 'Tbilisi', 'phone': '+995'}
        result = _normalize_client_response(body)
        self.assertEqual(result['name'], 'A B')
        self.assertEqual(result['phone'], '+995')
        self.assertEqual(result['raw'], body)

    def test_field_lookup_is_case_and_separator_insensitive(self):
        body = {'Name': 'A B', 'Address': 'Tbilisi', 'Phone': '+995'}
        result = _normalize_client_response(body)
        self.assertEqual(result['name'], 'A B')
        self.assertEqual(result['address'], 'Tbilisi')
        self.assertEqual(result['phone'], '+995')

    def test_non_dict_response_keeps_raw(self):
        result = _normalize_client_response('whatever')
        self.assertEqual(result, {'raw': 'whatever'})


class WebServiceUrlValidationTests(TestCase):
    def setUp(self):
        self.org = _make_organization()

    def test_strips_trailing_slash(self):
        serializer = OrganizationExternalServiceSerializer(
            self.org, data={'web_service_url': 'http://example.com/db/'}, partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['web_service_url'], 'http://example.com/db')

    def test_rejects_url_with_endpoint_suffix(self):
        serializer = OrganizationExternalServiceSerializer(
            self.org,
            data={'web_service_url': 'http://example.com/db/HS/ConsultWebExchange/CheckClient'},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('web_service_url', serializer.errors)

    def test_rejects_url_with_lowercase_endpoint_suffix(self):
        serializer = OrganizationExternalServiceSerializer(
            self.org,
            data={'web_service_url': 'http://example.com/db/hs/consultwebexchange/'},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())


class CreateOrderClientTests(TestCase):
    """ConsultWebExchangeClient.create_order — payload shape + real error contract.

    The upstream .docx status table (401–417) is wrong: the live service
    answers 400 (validation) / 404 (lookups) with ``{"success": false,
    "message": "..."}``. The client branches on that envelope, never on the
    documented custom codes.
    """

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

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


class StockQuantityPrecisionTests(TestCase):
    """1C types quantity/reserve as Number, and goods sold by weight really do
    come back fractional. An IntegerField silently floored 2.5 kg to 2, which
    understates stock and — at 0.5 — reads as out of stock entirely."""

    def _rows(self, **row):
        base = {'sku': 'S1', 'sku_name': 'N', 'article': 'A',
                'images': [], 'category_path': [], 'attributes': []}
        stock_row = {'warehouse': 'W1', 'warehouse_name': 'Main', 'price': '1.00'}
        stock_row.update(row)
        base['stock'] = [stock_row]
        return ProductSearchSerializer(base).data['stock'][0]

    def test_fractional_quantity_is_not_truncated(self):
        self.assertEqual(Decimal(self._rows(quantity=2.5)['quantity']), Decimal('2.5'))

    def test_fractional_reserve_is_not_truncated(self):
        row = self._rows(quantity=10, reserve=1.5)
        self.assertEqual(Decimal(row['reserve']), Decimal('1.5'))

    def test_a_half_unit_does_not_collapse_to_out_of_stock(self):
        self.assertNotEqual(Decimal(self._rows(quantity=0.5)['quantity']), Decimal('0'))

    def test_whole_numbers_survive_the_round_trip(self):
        self.assertEqual(Decimal(self._rows(quantity=65)['quantity']), Decimal('65'))

    def test_negative_quantity_is_preserved(self):
        # 1C really does return negative on-hand figures (observed live: -11).
        self.assertEqual(Decimal(self._rows(quantity=-11)['quantity']), Decimal('-11'))

    def test_null_reserve_stays_null(self):
        self.assertIsNone(self._rows(quantity=1, reserve=None)['reserve'])
