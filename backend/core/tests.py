"""Tests for the ConsultWebExchange integration and PurchaseOrder denormalization."""

from __future__ import annotations

import base64
import os
from unittest import mock

import httpx
from cryptography.fernet import Fernet
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.test import APIClient

from core.models import Organization, PurchaseOrder, PurchaseOrderItem, Warehouse
from core.serializers import (
    OrganizationExternalServiceSerializer,
    OrganizationSerializer,
    PurchaseOrderSerializer,
)
from core.services.consult_web_exchange import (
    ConsultWebExchangeClient,
    ConsultWebExchangeError,
    _normalize_client_response,
)
from core.services.nominatim import NominatimError, reverse_geocode
from users.models import User


_TEST_FERNET_KEY = Fernet.generate_key().decode()


def _make_organization(**overrides) -> Organization:
    defaults = dict(
        name=overrides.pop('name', 'TestOrg'),
        identification_number=overrides.pop('identification_number', '123456789'),
        web_service_url=overrides.pop('web_service_url', 'http://example.com/db'),
        web_service_username=overrides.pop('web_service_username', 'svc-user'),
        employees_count=overrides.pop('employees_count', 5),
    )
    defaults.update(overrides)
    return Organization.objects.create(**defaults)


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


class PurchaseOrderDenormalizedSearchTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='u1', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Nino Beridze', customer_phone='+995555',
            customer_identification_number='11111',
        )
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Giorgi Tabidze', customer_phone='+995777',
            customer_identification_number='22222',
        )

    def test_filter_by_external_client_id(self):
        PurchaseOrder.objects.filter(customer_name='Nino Beridze').update(
            external_client_id='EXT-A',
        )
        qs = PurchaseOrder.objects.filter(external_client_id='EXT-A')
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.first().customer_name, 'Nino Beridze')

    def test_filter_by_customer_search_name(self):
        from django.db.models import Q
        qs = PurchaseOrder.objects.filter(
            Q(customer_name__icontains='nino')
            | Q(customer_phone__icontains='nino')
            | Q(customer_identification_number__icontains='nino')
        )
        self.assertEqual([o.customer_name for o in qs], ['Nino Beridze'])

    def test_purchase_order_serializer_round_trip(self):
        order = PurchaseOrder.objects.first()
        data = PurchaseOrderSerializer(order).data
        self.assertIn('customer_name', data)
        self.assertIn('external_client_id', data)
        self.assertNotIn('customer', data)


# ---------------------------------------------------------------------------
# Reverse Geocode (Nominatim)
# ---------------------------------------------------------------------------

def _mock_httpx_response(status_code: int, body: object = None, json_raises: bool = False):
    resp = mock.Mock(spec=httpx.Response)
    resp.status_code = status_code
    if json_raises:
        resp.json.side_effect = ValueError('not json')
    else:
        resp.json.return_value = body if body is not None else {}
    return resp


class NominatimServiceTests(TestCase):
    def test_returns_display_name_on_200(self):
        with mock.patch(
            'httpx.get',
            return_value=_mock_httpx_response(200, {'display_name': 'Tbilisi, GE'}),
        ):
            self.assertEqual(reverse_geocode(41.7, 44.8), 'Tbilisi, GE')

    def test_uses_user_agent_from_settings(self):
        captured: dict = {}

        def fake_get(url, **kwargs):
            captured['url'] = url
            captured['headers'] = kwargs.get('headers')
            captured['params'] = kwargs.get('params')
            return _mock_httpx_response(200, {'display_name': 'X'})

        with override_settings(NOMINATIM_USER_AGENT='TestAgent/9.9'):
            with mock.patch('httpx.get', side_effect=fake_get):
                reverse_geocode(41.7, 44.8)

        self.assertEqual(captured['headers']['User-Agent'], 'TestAgent/9.9')
        self.assertIn('lat', captured['params'])
        self.assertIn('lon', captured['params'])
        self.assertEqual(captured['params']['format'], 'json')

    def test_raises_not_found_on_error_payload(self):
        with mock.patch(
            'httpx.get',
            return_value=_mock_httpx_response(200, {'error': 'Unable to geocode'}),
        ):
            with self.assertRaises(NominatimError) as ctx:
                reverse_geocode(0, 0)
        self.assertEqual(ctx.exception.code, 'REVERSE_GEOCODE_NOT_FOUND')
        self.assertEqual(ctx.exception.http_status, 404)

    def test_raises_not_found_on_empty_display_name(self):
        with mock.patch(
            'httpx.get',
            return_value=_mock_httpx_response(200, {'display_name': ''}),
        ):
            with self.assertRaises(NominatimError) as ctx:
                reverse_geocode(0, 0)
        self.assertEqual(ctx.exception.code, 'REVERSE_GEOCODE_NOT_FOUND')

    def test_maps_timeout_to_external_service_timeout(self):
        with mock.patch('httpx.get', side_effect=httpx.TimeoutException('boom')):
            with self.assertRaises(NominatimError) as ctx:
                reverse_geocode(41.7, 44.8)
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_TIMEOUT')
        self.assertEqual(ctx.exception.http_status, 504)

    def test_maps_connect_error_to_external_service_unavailable(self):
        with mock.patch('httpx.get', side_effect=httpx.ConnectError('boom')):
            with self.assertRaises(NominatimError) as ctx:
                reverse_geocode(41.7, 44.8)
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_UNAVAILABLE')

    def test_maps_non_200_to_external_service_error(self):
        with mock.patch('httpx.get', return_value=_mock_httpx_response(503)):
            with self.assertRaises(NominatimError) as ctx:
                reverse_geocode(41.7, 44.8)
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_ERROR')
        self.assertEqual(ctx.exception.upstream_status, 503)


@override_settings(SECURE_SSL_REDIRECT=False)
class ReverseGeocodeAPIViewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.user = User.objects.create_user(
            username='u', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('client-reverse-geocode')

    def tearDown(self):
        cache.clear()
        os.environ.pop('FERNET_KEY', None)

    def test_anonymous_request_is_rejected(self):
        anon = APIClient()
        response = anon.post(self.url, {'lat': 41.7, 'lng': 44.8}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_happy_path_returns_address(self):
        with mock.patch(
            'httpx.get',
            return_value=_mock_httpx_response(200, {'display_name': 'Tbilisi, GE'}),
        ):
            response = self.client_api.post(
                self.url, {'lat': 41.7, 'lng': 44.8}, format='json',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'address': 'Tbilisi, GE'})

    def test_validation_rejects_out_of_range_lat(self):
        response = self.client_api.post(
            self.url, {'lat': 999, 'lng': 0}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_validation_rejects_out_of_range_lng(self):
        response = self.client_api.post(
            self.url, {'lat': 0, 'lng': 999}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_timeout_returns_504_envelope(self):
        with mock.patch('httpx.get', side_effect=httpx.TimeoutException('boom')):
            response = self.client_api.post(
                self.url, {'lat': 41.7, 'lng': 44.8}, format='json',
            )
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.data['code'], 'EXTERNAL_SERVICE_TIMEOUT')
        self.assertIn('detail', response.data)

    def test_not_found_returns_404_envelope(self):
        with mock.patch(
            'httpx.get',
            return_value=_mock_httpx_response(200, {'error': 'Unable to geocode'}),
        ):
            response = self.client_api.post(
                self.url, {'lat': 0, 'lng': 0}, format='json',
            )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'REVERSE_GEOCODE_NOT_FOUND')

    def test_caches_repeat_calls_within_precision(self):
        call_count = {'n': 0}

        def fake_get(url, **kwargs):
            call_count['n'] += 1
            return _mock_httpx_response(200, {'display_name': 'cached'})

        with mock.patch('httpx.get', side_effect=fake_get):
            r1 = self.client_api.post(
                self.url, {'lat': 41.71234, 'lng': 44.82345}, format='json',
            )
            # Within 4-decimal cache key bucket (~10 m).
            r2 = self.client_api.post(
                self.url, {'lat': 41.71234, 'lng': 44.82345}, format='json',
            )

        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.data['address'], 'cached')
        self.assertEqual(call_count['n'], 1)


class OrganizationInvoiceFieldsTests(TestCase):
    def test_invoice_fields_default_to_blank(self):
        org = _make_organization()
        self.assertEqual(org.invoice_logo, '')
        self.assertEqual(org.invoice_display_name, '')
        self.assertEqual(org.invoice_address, '')
        self.assertEqual(org.invoice_phone, '')
        self.assertEqual(org.invoice_email, '')
        self.assertEqual(org.invoice_footer_text, '')

    def test_invoice_fields_can_be_set(self):
        org = _make_organization(
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
            invoice_display_name='Acme Retail',
            invoice_address='12 Main St\nTbilisi',
            invoice_phone='+995 555 000 111',
            invoice_email='hello@acme.example',
            invoice_footer_text='Thank you for your business.',
        )
        org.refresh_from_db()
        self.assertEqual(org.invoice_display_name, 'Acme Retail')
        self.assertIn('iVBORw0KGgo=', org.invoice_logo)
        self.assertIn('Tbilisi', org.invoice_address)


class OrganizationInvoiceLogoValidationTests(TestCase):
    def setUp(self):
        self.base_payload = {
            'name': 'NewOrg',
            'identification_number': '999999999',
            'web_service_url': 'http://example.com/db',
            'employees_count': 3,
        }

    def _data_url(self, mime: str, raw_size_bytes: int) -> str:
        raw = b'A' * raw_size_bytes
        return f'data:{mime};base64,{base64.b64encode(raw).decode()}'

    def test_blank_logo_is_accepted(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload, 'invoice_logo': ''},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_valid_png_data_url_is_accepted(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('image/png', 1024)},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_non_image_mime_is_rejected(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('application/pdf', 100)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)

    def test_oversize_logo_is_rejected(self):
        # 1 MiB + 1 byte raw → > cap after base64
        serializer = OrganizationSerializer(
            data={**self.base_payload,
                  'invoice_logo': self._data_url('image/png', 1_048_577)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)

    def test_garbage_string_is_rejected(self):
        serializer = OrganizationSerializer(
            data={**self.base_payload, 'invoice_logo': 'not-a-data-url'},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('invoice_logo', serializer.errors)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceEndpointTests(TestCase):
    def setUp(self):
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org_a = _make_organization(name='OrgA', identification_number='100')
        self.org_b = _make_organization(name='OrgB', identification_number='200')
        self.user_a = User.objects.create_user(
            username='ua', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_a,
        )
        self.user_b = User.objects.create_user(
            username='ub', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_b,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Nino Beridze', status='confirmed',
        )
        self.client_a = APIClient()
        self.client_a.force_authenticate(self.user_a)

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _url(self, order_id):
        return f'/api/v1/orders/{order_id}/invoice/'

    def test_invoice_returns_html_for_own_org(self):
        response = self.client_a.get(self._url(self.order_a.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response['Content-Type'])
        body = response.content.decode()
        self.assertIn('Nino Beridze', body)
        self.assertIn(f'#{self.order_a.id}', body)

    def test_invoice_returns_404_for_foreign_org(self):
        response = self.client_a.get(self._url(
            PurchaseOrder.objects.create(
                organization=self.org_b, created_by=self.user_b,
                customer_name='Foreign',
            ).id
        ))
        self.assertEqual(response.status_code, 404)

    def test_invoice_unauthenticated_returns_401_or_403(self):
        anon = APIClient()
        response = anon.get(self._url(self.order_a.id))
        self.assertIn(response.status_code, (401, 403))

    def test_draft_invoice_includes_draft_watermark(self):
        draft = PurchaseOrder.objects.create(
            organization=self.org_a, created_by=self.user_a,
            customer_name='Drafty', status='draft',
        )
        response = self.client_a.get(self._url(draft.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('DRAFT', response.content.decode())

    def test_confirmed_invoice_omits_draft_watermark(self):
        response = self.client_a.get(self._url(self.order_a.id))
        body = response.content.decode()
        # The DRAFT element must not render for a confirmed order;
        # the CSS rule is allowed to remain in the stylesheet (harmless
        # when nothing matches it).
        self.assertNotIn('>DRAFT<', body)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceTemplateEndpointTests(TestCase):
    def setUp(self):
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org = _make_organization(name='OrgT', identification_number='300')
        self.admin = User.objects.create_user(
            username='admin', password='p',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
            is_staff=True,
        )
        self.user = User.objects.create_user(
            username='user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.url = '/api/v1/organizations/my-organization/invoice-template/'

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _admin_client(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        return c

    def test_get_returns_current_template_for_company_admin(self):
        self.org.invoice_display_name = 'Acme'
        self.org.invoice_phone = '+995 555 000 111'
        self.org.save()
        response = self._admin_client().get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['invoice_display_name'], 'Acme')
        self.assertEqual(response.data['invoice_phone'], '+995 555 000 111')
        # Always echoes all 6 fields, even when blank.
        self.assertIn('invoice_logo', response.data)
        self.assertIn('invoice_address', response.data)
        self.assertIn('invoice_email', response.data)
        self.assertIn('invoice_footer_text', response.data)

    def test_patch_updates_template_for_company_admin(self):
        response = self._admin_client().patch(
            self.url,
            {'invoice_display_name': 'New Name', 'invoice_phone': '+1 555'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.org.refresh_from_db()
        self.assertEqual(self.org.invoice_display_name, 'New Name')
        self.assertEqual(self.org.invoice_phone, '+1 555')

    def test_patch_rejects_oversize_logo(self):
        import base64
        oversized = b'A' * 1_048_577
        data_url = f'data:image/png;base64,{base64.b64encode(oversized).decode()}'
        response = self._admin_client().patch(
            self.url, {'invoice_logo': data_url}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('invoice_logo', response.data)

    def test_company_user_is_forbidden(self):
        c = APIClient()
        c.force_authenticate(self.user)
        response = c.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_anonymous_is_unauthorized(self):
        response = APIClient().get(self.url)
        self.assertIn(response.status_code, (401, 403))


from core.services.invoice_tokens import (
    DEFAULT_INVOICE_TEMPLATE_HTML,
    TOKEN_CATALOG,
    resolve_token,
)


class InvoiceTokenCatalogTests(TestCase):
    def test_catalog_contains_three_scopes(self):
        self.assertEqual(set(TOKEN_CATALOG.keys()), {'org', 'order', 'item'})

    def test_org_scope_includes_expected_keys(self):
        self.assertEqual(
            set(TOKEN_CATALOG['org'].keys()),
            {
                'logo', 'display_name', 'address', 'phone', 'email',
                'footer_text', 'identification_number', 'name',
            },
        )

    def test_item_scope_includes_expected_keys(self):
        self.assertEqual(
            set(TOKEN_CATALOG['item'].keys()),
            {
                'index', 'sku', 'sku_name', 'article', 'warehouse_name',
                'quantity', 'unit', 'price', 'discount', 'line_total',
            },
        )


class InvoiceTokenResolverTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
            invoice_address='Tbilisi\nKostava 1',
            invoice_phone='+995 555 11 22 33',
            invoice_email='acme@example.com',
            invoice_footer_text='Thanks for your business!',
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org,
            customer_name='John Doe',
            customer_phone='+995 555 99 88 77',
            customer_identification_number='ID-001',
            delivery_type='pickup',
            status='confirmed',
        )

    def test_resolve_org_display_name(self):
        self.assertEqual(resolve_token('org.display_name', org=self.org, order=self.order), 'Acme Display')

    def test_resolve_org_display_name_falls_back_to_name(self):
        self.org.invoice_display_name = ''
        self.assertEqual(resolve_token('org.display_name', org=self.org, order=self.order), 'Acme')

    def test_resolve_org_logo_returns_data_url(self):
        self.assertEqual(
            resolve_token('org.logo', org=self.org, order=self.order),
            'data:image/png;base64,iVBORw0KGgo=',
        )

    def test_resolve_order_id(self):
        self.assertEqual(resolve_token('order.id', org=self.org, order=self.order), str(self.order.id))

    def test_resolve_order_customer_name(self):
        self.assertEqual(resolve_token('order.customer_name', org=self.org, order=self.order), 'John Doe')

    def test_resolve_unknown_token_raises(self):
        with self.assertRaises(KeyError):
            resolve_token('org.does_not_exist', org=self.org, order=self.order)

    def test_resolve_item_warehouse_name(self):
        item = PurchaseOrderItem.objects.create(
            order=self.order, sku='X', sku_name='X', quantity=1, price=1,
            warehouse_name='Main Warehouse',
        )
        self.assertEqual(
            resolve_token('item.warehouse_name', item=item, index=1),
            'Main Warehouse',
        )

    def test_resolve_item_warehouse_name_empty(self):
        item = PurchaseOrderItem.objects.create(
            order=self.order, sku='X', sku_name='X', quantity=1, price=1,
        )
        self.assertEqual(
            resolve_token('item.warehouse_name', item=item, index=1),
            '',
        )


class DefaultInvoiceTemplateTests(TestCase):
    def test_default_template_is_non_empty_html(self):
        self.assertIn('<table', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-items-table', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-repeat="items"', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-token="org.display_name"', DEFAULT_INVOICE_TEMPLATE_HTML)
        self.assertIn('data-token="item.sku"', DEFAULT_INVOICE_TEMPLATE_HTML)


from core.services.invoice_renderer import (
    render_invoice_template,
    wrap_in_skeleton,
)


class InvoiceRendererTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
            invoice_logo='data:image/png;base64,iVBORw0KGgo=',
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, customer_name='John', delivery_type='pickup',
            status='confirmed',
        )
        # Two items so we can verify the row-clone count
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget', quantity=2,
            price=10, warehouse_name='Main',
        )
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU2', sku_name='Gadget', quantity=1,
            price=20, warehouse_name='Main',
        )

    def test_substitutes_org_token(self):
        template = '<p><span data-token="org.display_name"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('Acme Display', html)
        self.assertNotIn('data-token', html)

    def test_substitutes_order_token(self):
        template = '<p>#<span data-token="order.id"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn(f'#{self.order.id}', html)

    def test_org_logo_token_rewrites_img_src(self):
        template = '<img data-token="org.logo" alt="logo">'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('src="data:image/png;base64,iVBORw0KGgo="', html)
        self.assertNotIn('data-token', html)

    def test_clones_items_row_per_item(self):
        template = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items">'
            '<td><span data-token="item.sku"></span></td>'
            '<td><span data-token="item.index"></span></td>'
            '</tr></tbody></table>'
        )
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertEqual(html.count('<tr>'), 2)  # one row per item, marker removed
        self.assertIn('SKU1', html)
        self.assertIn('SKU2', html)
        self.assertNotIn('data-repeat', html)

    def test_item_index_is_one_based(self):
        template = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td><span data-token="item.index"></span></td></tr>'
            '</tbody></table>'
        )
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('>1<', html)
        self.assertIn('>2<', html)
        self.assertNotIn('>0<', html)

    def test_no_items_table_renders_no_items(self):
        template = '<p>Hello</p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertEqual(html.strip(), '<p>Hello</p>')

    def test_invalid_item_token_outside_row_renders_marker(self):
        template = '<p><span data-token="item.sku"></span></p>'
        html = render_invoice_template(template, org=self.org, order=self.order)
        self.assertIn('[invalid:item.sku]', html)

    def test_skeleton_wraps_body_with_print_css(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=False)
        self.assertIn('<html', wrapped)
        self.assertIn('<body', wrapped)
        self.assertIn('@page', wrapped)
        self.assertIn('<p>body</p>', wrapped)

    def test_skeleton_includes_draft_watermark_for_draft(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=True)
        self.assertIn('DRAFT', wrapped)

    def test_skeleton_omits_draft_watermark_for_confirmed(self):
        wrapped = wrap_in_skeleton('<p>body</p>', draft=False)
        self.assertNotIn('class="draft-watermark"', wrapped)



@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceEndpointRenderingTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
            invoice_display_name='Acme Display',
        )
        self.user = User.objects.create_user(
            username='admin', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org,
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, customer_name='John', delivery_type='pickup',
            status='confirmed',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_invoice_uses_custom_template_when_present(self):
        self.org.invoice_template_html = '<p>Custom-marker <span data-token="order.id"></span></p>'
        self.org.save()
        resp = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/')
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode('utf-8')
        self.assertIn('Custom-marker', body)
        self.assertIn(str(self.order.id), body)

    def test_invoice_falls_back_to_default_when_template_empty(self):
        self.org.invoice_template_html = ''
        self.org.save()
        resp = self.client.get(f'/api/v1/orders/{self.order.id}/invoice/')
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode('utf-8')
        self.assertIn('Acme Display', body)
        self.assertIn('INVOICE', body)


from core.services.invoice_template_sanitizer import (
    InvoiceTemplateValidationError,
    sanitize_and_validate,
)


class InvoiceTemplateSanitizerTests(TestCase):
    def test_strips_script_tag(self):
        result = sanitize_and_validate('<p>hi</p><script>alert(1)</script>')
        self.assertNotIn('<script', result)
        self.assertIn('<p>hi</p>', result)

    def test_strips_event_handlers(self):
        result = sanitize_and_validate('<p onclick="alert(1)">hi</p>')
        self.assertNotIn('onclick', result)

    def test_strips_dangerous_styles(self):
        result = sanitize_and_validate(
            '<p style="position: fixed; color: red; behavior: url(x);">hi</p>'
        )
        self.assertNotIn('position', result)
        self.assertNotIn('behavior', result)
        self.assertIn('color', result)

    def test_strips_javascript_uri_in_img_src(self):
        result = sanitize_and_validate('<img src="javascript:alert(1)" data-token="org.logo">')
        self.assertNotIn('javascript:', result)

    def test_allows_data_image_in_img_src(self):
        html = '<img data-token="org.logo" src="data:image/png;base64,abc">'
        result = sanitize_and_validate(html)
        self.assertIn('src="data:image/png;base64,abc"', result)

    def test_allows_data_token_attribute(self):
        result = sanitize_and_validate('<span data-token="org.display_name"></span>')
        self.assertIn('data-token="org.display_name"', result)

    def test_allows_data_repeat_attribute(self):
        result = sanitize_and_validate(
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td><span data-token="item.sku"></span></td></tr>'
            '</tbody></table>'
        )
        self.assertIn('data-repeat="items"', result)
        self.assertIn('data-items-table', result)

    def test_rejects_two_items_tables(self):
        html = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>a</td></tr></tbody></table>'
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>b</td></tr></tbody></table>'
        )
        with self.assertRaises(InvoiceTemplateValidationError) as ctx:
            sanitize_and_validate(html)
        self.assertIn('items table', str(ctx.exception).lower())

    def test_rejects_items_table_without_repeat_row(self):
        html = '<table data-items-table><tbody><tr><td>a</td></tr></tbody></table>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_rejects_unknown_token(self):
        html = '<span data-token="org.does_not_exist"></span>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_rejects_item_token_outside_repeat_row(self):
        html = '<p><span data-token="item.sku"></span></p>'
        with self.assertRaises(InvoiceTemplateValidationError):
            sanitize_and_validate(html)

    def test_accepts_default_template(self):
        from core.services.invoice_tokens import DEFAULT_INVOICE_TEMPLATE_HTML
        # Should not raise.
        sanitize_and_validate(DEFAULT_INVOICE_TEMPLATE_HTML)

    def test_empty_string_returns_empty(self):
        self.assertEqual(sanitize_and_validate(''), '')
