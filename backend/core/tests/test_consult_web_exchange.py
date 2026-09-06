from __future__ import annotations

import os

from core.serializers import OrganizationExternalServiceSerializer
from core.services.consult_web_exchange import ConsultWebExchangeClient, ConsultWebExchangeError, _normalize_client_response
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from django.test import TestCase, override_settings
from unittest import mock


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
