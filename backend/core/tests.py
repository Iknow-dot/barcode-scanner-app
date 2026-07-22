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
from django.utils import timezone

from core.services.photon import PhotonError, reverse_geocode, search_addresses
from core.image_urls import signed_image_path, signed_image_paths, verify_image_sig, _sig
from core.categories import normalize_category_chain, path_ids_string, path_names
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


@override_settings(SECURE_SSL_REDIRECT=False)
class ProductSearchIncludeImagesTests(TestCase):
    """Scan-miss path never inlines images anymore — it always returns proxy paths,
    regardless of the (now-inert) include_images flag, and never calls httpx.get."""

    def setUp(self):
        self.org = _make_organization()
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org.encrypt_password('s3cret')
        self.org.save()
        self.user = User.objects.create_user(
            username='ps_user', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        warehouse = Warehouse.objects.create(
            organization=self.org, code='W1', name='Main',
        )
        warehouse.users.add(self.user)
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('product-search')

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def _stock_response(self):
        return {
            'sku': 'SKU1',
            'sku_name': 'Name',
            'article': 'A1',
            'price': '10.00',
            'stock': [{
                'warehouse': 'W1',
                'warehouse_name': 'Main',
                'quantity': 5,
                'price': '10.00',
            }],
            'img_url': ['https://example.invalid/img.jpg'],
        }

    def test_include_images_false_still_returns_proxy_paths(self):
        with mock.patch('core.views.ConsultWebExchangeClient') as cls:
            cls.return_value.get_stock_and_prices.return_value = self._stock_response()
            with mock.patch('core.views.httpx.get') as httpx_get:
                response = self.client_api.post(
                    self.url,
                    {'sku': 'SKU1', 'is_barcode': True, 'warehouses': ['W1'],
                     'include_images': False},
                    format='json',
                )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['images'], [signed_image_path(self.org.id, 'SKU1', 0)])
        httpx_get.assert_not_called()

    def test_include_images_default_true_returns_proxy_paths_without_fetching(self):
        with mock.patch('core.views.ConsultWebExchangeClient') as cls:
            cls.return_value.get_stock_and_prices.return_value = self._stock_response()
            with mock.patch('core.views.httpx.get') as httpx_get:
                response = self.client_api.post(
                    self.url,
                    {'sku': 'SKU1', 'is_barcode': True, 'warehouses': ['W1']},
                    format='json',
                )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['images']), 1)
        httpx_get.assert_not_called()


# ---------------------------------------------------------------------------
# Reverse Geocode (Photon)
# ---------------------------------------------------------------------------

def _mock_httpx_response(status_code: int, body: object = None, json_raises: bool = False):
    resp = mock.Mock(spec=httpx.Response)
    resp.status_code = status_code
    if json_raises:
        resp.json.side_effect = ValueError('not json')
    else:
        resp.json.return_value = body if body is not None else {}
    return resp


def _photon_feature(coordinates=(0.0, 0.0), **props) -> dict:
    return {
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': list(coordinates)},
        'properties': props,
    }


def _photon_collection(*features) -> dict:
    return {'type': 'FeatureCollection', 'features': list(features)}


class PhotonReverseServiceTests(TestCase):
    def test_returns_first_formatted_feature_on_200(self):
        body = _photon_collection(
            _photon_feature(
                street='Pekini Avenue', housenumber='12',
                city='Tbilisi', country='Georgia',
            ),
        )
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(
                reverse_geocode(41.7, 44.8),
                'Pekini Avenue 12, Tbilisi, Georgia',
            )

    def test_uses_user_agent_from_settings(self):
        captured: dict = {}

        def fake_get(url, **kwargs):
            captured['url'] = url
            captured['headers'] = kwargs.get('headers')
            captured['params'] = kwargs.get('params')
            return _mock_httpx_response(
                200, _photon_collection(_photon_feature(name='X')),
            )

        with override_settings(NOMINATIM_USER_AGENT='TestAgent/9.9'):
            with mock.patch('httpx.get', side_effect=fake_get):
                reverse_geocode(41.7, 44.8)

        self.assertEqual(captured['url'], 'https://photon.komoot.io/reverse')
        self.assertEqual(captured['headers']['User-Agent'], 'TestAgent/9.9')
        self.assertEqual(captured['params']['lat'], 41.7)
        self.assertEqual(captured['params']['lon'], 44.8)

    def test_raises_not_found_on_empty_features(self):
        with mock.patch(
            'httpx.get',
            return_value=_mock_httpx_response(200, _photon_collection()),
        ):
            with self.assertRaises(PhotonError) as ctx:
                reverse_geocode(0, 0)
        self.assertEqual(ctx.exception.code, 'REVERSE_GEOCODE_NOT_FOUND')
        self.assertEqual(ctx.exception.http_status, 404)

    def test_raises_not_found_when_features_have_no_usable_props(self):
        body = _photon_collection(_photon_feature())
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            with self.assertRaises(PhotonError) as ctx:
                reverse_geocode(0, 0)
        self.assertEqual(ctx.exception.code, 'REVERSE_GEOCODE_NOT_FOUND')

    def test_maps_timeout_to_external_service_timeout(self):
        with mock.patch('httpx.get', side_effect=httpx.TimeoutException('boom')):
            with self.assertRaises(PhotonError) as ctx:
                reverse_geocode(41.7, 44.8)
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_TIMEOUT')
        self.assertEqual(ctx.exception.http_status, 504)

    def test_maps_connect_error_to_external_service_unavailable(self):
        with mock.patch('httpx.get', side_effect=httpx.ConnectError('boom')):
            with self.assertRaises(PhotonError) as ctx:
                reverse_geocode(41.7, 44.8)
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_UNAVAILABLE')

    def test_maps_non_200_to_external_service_error(self):
        with mock.patch('httpx.get', return_value=_mock_httpx_response(503)):
            with self.assertRaises(PhotonError) as ctx:
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
        body = _photon_collection(
            _photon_feature(name='Tbilisi', country='Georgia'),
        )
        with mock.patch(
            'httpx.get',
            return_value=_mock_httpx_response(200, body),
        ):
            response = self.client_api.post(
                self.url, {'lat': 41.7, 'lng': 44.8}, format='json',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'address': 'Tbilisi, Georgia'})

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
            return_value=_mock_httpx_response(200, _photon_collection()),
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
            return _mock_httpx_response(
                200, _photon_collection(_photon_feature(name='cached')),
            )

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


class PhotonServiceTests(TestCase):
    def test_formats_street_with_housenumber(self):
        body = _photon_collection(
            _photon_feature(
                coordinates=(44.8271, 41.7151),
                street='Pekini Avenue',
                housenumber='12',
                city='Tbilisi',
                country='Georgia',
            ),
        )
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(
                search_addresses('q'),
                [{
                    'label': 'Pekini Avenue 12, Tbilisi, Georgia',
                    'lat': 41.7151,
                    'lng': 44.8271,
                }],
            )

    def test_formats_street_without_housenumber(self):
        body = _photon_collection(
            _photon_feature(street='Rustaveli Avenue', city='Tbilisi', country='Georgia'),
        )
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(
                search_addresses('q'),
                [{'label': 'Rustaveli Avenue, Tbilisi, Georgia', 'lat': 0.0, 'lng': 0.0}],
            )

    def test_falls_back_to_name_when_no_street(self):
        body = _photon_collection(
            _photon_feature(name='Dry Bridge', city='Tbilisi', country='Georgia'),
        )
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(
                search_addresses('q'),
                [{'label': 'Dry Bridge, Tbilisi, Georgia', 'lat': 0.0, 'lng': 0.0}],
            )

    def test_drops_blank_and_duplicate_parts(self):
        body = _photon_collection(
            _photon_feature(name='Tbilisi', city='Tbilisi', country='Georgia'),
        )
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(
                search_addresses('q'),
                [{'label': 'Tbilisi, Georgia', 'lat': 0.0, 'lng': 0.0}],
            )

    def test_deduplicates_features_with_same_formatted_string(self):
        body = _photon_collection(
            _photon_feature(name='X', city='Tbilisi', country='Georgia'),
            _photon_feature(name='X', city='Tbilisi', country='Georgia'),
        )
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(
                search_addresses('q'),
                [{'label': 'X, Tbilisi, Georgia', 'lat': 0.0, 'lng': 0.0}],
            )

    def test_drops_features_without_usable_geometry(self):
        # Photon should never omit `geometry`, but tolerate it: no coords →
        # nothing to plot on the map, so the item is unusable.
        body = {
            'type': 'FeatureCollection',
            'features': [
                {
                    'type': 'Feature',
                    'properties': {'name': 'NoGeom', 'country': 'Georgia'},
                },
                _photon_feature(name='HasGeom', country='Georgia'),
            ],
        }
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(
                search_addresses('q'),
                [{'label': 'HasGeom, Georgia', 'lat': 0.0, 'lng': 0.0}],
            )

    def test_returns_empty_list_when_no_features(self):
        body = _photon_collection()
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            self.assertEqual(search_addresses('q'), [])

    def test_returns_empty_list_when_body_is_not_dict(self):
        with mock.patch(
            'httpx.get', return_value=_mock_httpx_response(200, ['unexpected']),
        ):
            self.assertEqual(search_addresses('q'), [])

    def test_sends_q_limit_lang_and_bias_by_default(self):
        captured: dict = {}

        def fake_get(url, **kwargs):
            captured['url'] = url
            captured['params'] = kwargs.get('params')
            return _mock_httpx_response(200, _photon_collection())

        with mock.patch('httpx.get', side_effect=fake_get):
            search_addresses('  Rustaveli  ', limit=5)

        self.assertEqual(captured['url'], 'https://photon.komoot.io/api/')
        self.assertEqual(captured['params']['q'], '  Rustaveli  ')
        self.assertEqual(captured['params']['limit'], 5)
        self.assertEqual(captured['params']['lang'], 'en')
        self.assertIn('lat', captured['params'])
        self.assertIn('lon', captured['params'])

    def test_bias_can_be_disabled(self):
        captured: dict = {}

        def fake_get(url, **kwargs):
            captured['params'] = kwargs.get('params')
            return _mock_httpx_response(200, _photon_collection())

        with mock.patch('httpx.get', side_effect=fake_get):
            search_addresses('q', bias=None)

        self.assertNotIn('lat', captured['params'])
        self.assertNotIn('lon', captured['params'])

    def test_limit_is_clamped_to_max(self):
        captured: dict = {}

        def fake_get(url, **kwargs):
            captured['params'] = kwargs.get('params')
            return _mock_httpx_response(200, _photon_collection())

        with mock.patch('httpx.get', side_effect=fake_get):
            search_addresses('q', limit=999)

        self.assertEqual(captured['params']['limit'], 15)

    def test_maps_timeout_to_external_service_timeout(self):
        with mock.patch('httpx.get', side_effect=httpx.TimeoutException('boom')):
            with self.assertRaises(PhotonError) as ctx:
                search_addresses('q')
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_TIMEOUT')
        self.assertEqual(ctx.exception.http_status, 504)

    def test_maps_connect_error_to_external_service_unavailable(self):
        with mock.patch('httpx.get', side_effect=httpx.ConnectError('boom')):
            with self.assertRaises(PhotonError) as ctx:
                search_addresses('q')
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_UNAVAILABLE')

    def test_maps_non_200_to_external_service_error(self):
        with mock.patch('httpx.get', return_value=_mock_httpx_response(503)):
            with self.assertRaises(PhotonError) as ctx:
                search_addresses('q')
        self.assertEqual(ctx.exception.code, 'EXTERNAL_SERVICE_ERROR')
        self.assertEqual(ctx.exception.upstream_status, 503)


@override_settings(SECURE_SSL_REDIRECT=False)
class SearchAddressesAPIViewTests(TestCase):
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
        self.url = reverse('client-search-addresses')

    def tearDown(self):
        cache.clear()
        os.environ.pop('FERNET_KEY', None)

    def test_anonymous_request_is_rejected(self):
        anon = APIClient()
        response = anon.post(self.url, {'q': 'Tbilisi'}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_happy_path_returns_suggestions(self):
        body = _photon_collection(
            _photon_feature(
                coordinates=(44.7, 41.7),
                street='Pekini Avenue', housenumber='12',
                city='Tbilisi', country='Georgia',
            ),
            _photon_feature(
                coordinates=(44.8, 41.8),
                street='Rustaveli Avenue',
                city='Tbilisi', country='Georgia',
            ),
        )
        with mock.patch('httpx.get', return_value=_mock_httpx_response(200, body)):
            response = self.client_api.post(
                self.url, {'q': 'Tbilisi'}, format='json',
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data,
            {'suggestions': [
                {
                    'label': 'Pekini Avenue 12, Tbilisi, Georgia',
                    'lat': 41.7,
                    'lng': 44.7,
                },
                {
                    'label': 'Rustaveli Avenue, Tbilisi, Georgia',
                    'lat': 41.8,
                    'lng': 44.8,
                },
            ]},
        )

    def test_short_query_returns_empty_without_calling_upstream(self):
        with mock.patch('httpx.get') as get_mock:
            response = self.client_api.post(self.url, {'q': 'ab'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'suggestions': []})
        get_mock.assert_not_called()

    def test_validation_rejects_missing_q(self):
        response = self.client_api.post(self.url, {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_validation_rejects_too_long_q(self):
        response = self.client_api.post(
            self.url, {'q': 'x' * 201}, format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_timeout_returns_504_envelope(self):
        with mock.patch('httpx.get', side_effect=httpx.TimeoutException('boom')):
            response = self.client_api.post(
                self.url, {'q': 'Tbilisi'}, format='json',
            )
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.data['code'], 'EXTERNAL_SERVICE_TIMEOUT')
        self.assertIn('detail', response.data)

    def test_caches_repeat_calls_for_same_query(self):
        call_count = {'n': 0}

        def fake_get(url, **kwargs):
            call_count['n'] += 1
            return _mock_httpx_response(
                200,
                _photon_collection(
                    _photon_feature(name='cached', city='Tbilisi', country='Georgia'),
                ),
            )

        with mock.patch('httpx.get', side_effect=fake_get):
            r1 = self.client_api.post(self.url, {'q': 'Tbilisi'}, format='json')
            # Same query, different casing — cache key is lower-cased.
            r2 = self.client_api.post(self.url, {'q': 'TBILISI'}, format='json')

        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(
            r1.data['suggestions'],
            [{'label': 'cached, Tbilisi, Georgia', 'lat': 0.0, 'lng': 0.0}],
        )
        self.assertEqual(call_count['n'], 1)

    def test_upstream_403_returns_502_envelope(self):
        with mock.patch(
            'httpx.get', return_value=_mock_httpx_response(403),
        ):
            response = self.client_api.post(
                self.url, {'q': 'Tbilisi'}, format='json',
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.data['code'], 'EXTERNAL_SERVICE_ERROR')
        self.assertEqual(response.data['external_service_status_code'], 403)


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

    def test_resolve_item_discount_zero_decimal_is_rendered(self):
        from decimal import Decimal
        item = PurchaseOrderItem.objects.create(
            order=self.order, sku='X', sku_name='X', quantity=1, price=10,
            discounted_price=Decimal('0.00'),
        )
        result = resolve_token('item.discount', item=item, index=1)
        self.assertIn('0', result)
        self.assertNotEqual(result, '—')


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


from core.models import Product, ProductBarcode, CatalogIngestState, OrganizationPushAllowedIP
from core.image_proxy_safety import (
    assert_safe_image_url, sanitized_image_content_type, UnsafeImageURL, ALLOWED_IMAGE_TYPES,
)


class CatalogModelTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )

    def test_product_unique_per_org_sku_and_barcode_lookup(self):
        p = Product.objects.create(organization=self.org, sku="S1", name="Candle")
        ProductBarcode.objects.create(product=p, barcode="123")
        hit = ProductBarcode.objects.filter(product__organization=self.org, barcode="123").first()
        self.assertEqual(hit.product, p)

    def test_ingest_state_is_stale_when_never_pushed(self):
        st = CatalogIngestState.objects.create(organization=self.org)
        self.assertTrue(st.is_stale)
        st.last_delta_push_at = timezone.now()
        self.assertFalse(st.is_stale)


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
        self.assertNotIn('expression', result.lower())

    def test_strips_expression_in_allowed_property(self):
        result = sanitize_and_validate('<p style="width: expression(alert(1));">hi</p>')
        self.assertNotIn('expression', result.lower())

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

    def test_allows_colgroup_and_col(self):
        """TipTap resizable table emits <colgroup><col style="width:..."></colgroup>."""
        html = (
            '<table data-items-table>'
            '<colgroup><col style="width: 120px;"><col style="width: 80px;"></colgroup>'
            '<tbody>'
            '<tr data-repeat="items"><td><span data-token="item.sku"></span></td></tr>'
            '</tbody></table>'
        )
        result = sanitize_and_validate(html)
        self.assertIn('<colgroup>', result)
        self.assertIn('<col', result)
        self.assertIn('width: 120px', result)

    def test_img_width_and_height_attrs_survive_sanitization(self):
        """<img> elements with width/height attrs must pass through bleach intact."""
        html = '<img src="data:image/png;base64,abc" width="200" height="150" alt="test">'
        result = sanitize_and_validate(html)
        self.assertIn('width="200"', result)
        self.assertIn('height="150"', result)
        self.assertIn('src="data:image/png;base64,abc"', result)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceTemplateSaveTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
        )
        self.admin = User.objects.create_user(
            username='admin', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_get_returns_invoice_template_html(self):
        self.org.invoice_template_html = '<p>hi</p>'
        self.org.save()
        resp = self.client.get('/api/v1/organizations/my-organization/invoice-template/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['invoice_template_html'], '<p>hi</p>')

    def test_patch_persists_sanitized_invoice_template_html(self):
        payload = {'invoice_template_html': '<p>hi</p><script>alert(1)</script>'}
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data=payload, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.org.refresh_from_db()
        self.assertIn('<p>hi</p>', self.org.invoice_template_html)
        self.assertNotIn('<script', self.org.invoice_template_html)

    def test_patch_rejects_two_items_tables(self):
        bad = (
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>a</td></tr></tbody></table>'
            '<table data-items-table><tbody>'
            '<tr data-repeat="items"><td>b</td></tr></tbody></table>'
        )
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data={'invoice_template_html': bad}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('INVOICE_TEMPLATE_INVALID', str(resp.content))

    def test_patch_rejects_unknown_token(self):
        resp = self.client.patch(
            '/api/v1/organizations/my-organization/invoice-template/',
            data={'invoice_template_html': '<span data-token="org.nope"></span>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceTokensEndpointTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name='Acme', identification_number='123456789',
            web_service_url='https://example.com', employees_count=5,
        )
        self.user = User.objects.create_user(
            username='u', password='pw', role=User.Role.COMPANY_USER,
            organization=self.org,
        )
        self.client = APIClient()

    def test_unauthenticated_returns_401(self):
        resp = self.client.get('/api/v1/invoice-tokens/')
        self.assertEqual(resp.status_code, 401)

    def test_authenticated_returns_catalog_and_default(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get('/api/v1/invoice-tokens/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('tokens', resp.data)
        self.assertIn('default_template_html', resp.data)
        self.assertIn('org', resp.data['tokens'])
        self.assertIn('order', resp.data['tokens'])
        self.assertIn('item', resp.data['tokens'])
        self.assertIn('display_name', resp.data['tokens']['org'])
        self.assertIn('data-items-table', resp.data['default_template_html'])


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoiceSampleValuesEndpointTests(TestCase):
    URL = '/api/v1/invoice-tokens/sample-values/'

    def setUp(self):
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        self.org_a = _make_organization(name='OrgSV-A', identification_number='700',
                                        invoice_display_name='Acme Sample Ltd')
        self.org_b = _make_organization(name='OrgSV-B', identification_number='800')
        self.user_a = User.objects.create_user(
            username='sv_ua', password='p',
            role=User.Role.COMPANY_ADMIN, organization=self.org_a,
        )
        self.user_b = User.objects.create_user(
            username='sv_ub', password='p',
            role=User.Role.COMPANY_USER, organization=self.org_b,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, customer_name='Sample Customer',
            delivery_type='pickup', status='confirmed',
        )
        PurchaseOrderItem.objects.create(
            order=self.order_a, sku='SKU-001', sku_name='Widget',
            quantity=2, price=10,
        )
        self.client_a = APIClient()
        self.client_a.force_authenticate(self.user_a)

    def tearDown(self):
        os.environ.pop('FERNET_KEY', None)

    def test_unauthenticated_returns_401(self):
        anon = APIClient()
        response = anon.get(self.URL)
        self.assertEqual(response.status_code, 401)

    def test_returns_org_values_for_own_org(self):
        response = self.client_a.get(self.URL)
        self.assertEqual(response.status_code, 200)
        self.assertIn('org.display_name', response.data)
        self.assertEqual(response.data['org.display_name'], 'Acme Sample Ltd')
        self.assertIn('org.name', response.data)

    def test_with_order_id_returns_order_and_item_values(self):
        response = self.client_a.get(self.URL, {'order_id': self.order_a.id})
        self.assertEqual(response.status_code, 200)
        self.assertIn('order.customer_name', response.data)
        self.assertEqual(response.data['order.customer_name'], 'Sample Customer')
        self.assertIn('item.sku', response.data)
        self.assertEqual(response.data['item.sku'], 'SKU-001')

    def test_cross_org_order_returns_404(self):
        order_b = PurchaseOrder.objects.create(
            organization=self.org_b, customer_name='Foreign',
            delivery_type='pickup', status='draft',
        )
        response = self.client_a.get(self.URL, {'order_id': order_b.id})
        self.assertEqual(response.status_code, 404)

    def test_without_order_id_and_no_orders_returns_only_org_keys(self):
        # Create a fresh org + user with no orders.
        org_empty = _make_organization(name='OrgEmpty', identification_number='999')
        user_empty = User.objects.create_user(
            username='empty_u', password='p',
            role=User.Role.COMPANY_USER, organization=org_empty,
        )
        c = APIClient()
        c.force_authenticate(user_empty)
        response = c.get(self.URL)
        self.assertEqual(response.status_code, 200)
        self.assertIn('org.display_name', response.data)
        self.assertNotIn('order.id', response.data)
        self.assertNotIn('item.sku', response.data)

    def test_keys_are_flat(self):
        response = self.client_a.get(self.URL)
        self.assertEqual(response.status_code, 200)
        for key in response.data:
            self.assertIn('.', key, msg=f'Key {key!r} is not flat scope.name format')
            self.assertNotIsInstance(response.data[key], dict)


@override_settings(SECURE_SSL_REDIRECT=False)
class InvoicePreviewEndpointTests(TestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(
            name='A', identification_number='1', web_service_url='https://a.example',
            employees_count=5,
        )
        self.org_b = Organization.objects.create(
            name='B', identification_number='2', web_service_url='https://b.example',
            employees_count=5,
        )
        self.user_a = User.objects.create_user(
            username='a', password='pw', role=User.Role.COMPANY_ADMIN,
            organization=self.org_a,
        )
        self.order_a = PurchaseOrder.objects.create(
            organization=self.org_a, customer_name='Alice', delivery_type='pickup',
            status='confirmed',
        )
        self.order_b = PurchaseOrder.objects.create(
            organization=self.org_b, customer_name='Bob', delivery_type='pickup',
            status='confirmed',
        )
        self.client = APIClient()

    def test_unauthenticated_returns_401(self):
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<p>x</p>'}, format='json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_renders_override_without_persisting(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<p>PREVIEW-MARKER</p>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('PREVIEW-MARKER', resp.content.decode('utf-8'))
        self.org_a.refresh_from_db()
        self.assertNotEqual(self.org_a.invoice_template_html, '<p>PREVIEW-MARKER</p>')

    def test_invalid_template_returns_400(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_a.id}/invoice-preview/',
            data={'invoice_template_html': '<span data-token="org.nope"></span>'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('INVOICE_TEMPLATE_INVALID', str(resp.content))

    def test_cross_org_order_returns_404(self):
        self.client.force_authenticate(self.user_a)
        resp = self.client.post(
            f'/api/v1/orders/{self.order_b.id}/invoice-preview/',
            data={'invoice_template_html': '<p>x</p>'}, format='json',
        )
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Bulk update order items
# ---------------------------------------------------------------------------

class BulkUpdateOrderItemsSerializerTests(TestCase):
    def test_rejects_empty_item_ids(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'item_ids': [], 'data': {'price': '10.00'}})
        self.assertFalse(s.is_valid())
        self.assertIn('item_ids', s.errors)

    def test_rejects_missing_item_ids(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'data': {'price': '10.00'}})
        self.assertFalse(s.is_valid())
        self.assertIn('item_ids', s.errors)

    def test_rejects_empty_data(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'item_ids': [1, 2], 'data': {}})
        self.assertFalse(s.is_valid())
        self.assertIn('data', s.errors)

    def test_accepts_valid_payload(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1, 2, 3],
            'data': {'price': '12.50', 'unit': 'piece', 'discount_percent': '5.00'},
        })
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data['item_ids'], [1, 2, 3])
        self.assertEqual(s.validated_data['data']['unit'], 'piece')

    def test_accepts_discounted_price_null(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1],
            'data': {'discounted_price': None, 'discount_percent': '0'},
        })
        self.assertTrue(s.is_valid(), s.errors)
        self.assertIsNone(s.validated_data['data']['discounted_price'])

    def test_rejects_quantity_field(self):
        """quantity is intentionally NOT in the bulk-update whitelist —
        per-warehouse qty has its own update_item endpoint."""
        from core.serializers import BulkUpdateOrderItemsSerializer
        # quantity-only payload should be treated as empty data and rejected
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1],
            'data': {'quantity': 5},
        })
        self.assertFalse(s.is_valid())
        self.assertIn('data', s.errors)


@override_settings(SECURE_SSL_REDIRECT=False)
class PurchaseOrderBulkUpdateTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='consultant', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
            can_apply_discount=True, max_discount_percent=20,
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Cust',
        )
        self.item_a = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=2, warehouse_code='WHA',
            warehouse_name='WH-A',
        )
        self.item_b = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=3, warehouse_code='WHB',
            warehouse_name='WH-B',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/orders/{self.order.id}/items/bulk-update/'

    def test_bulk_update_price_applies_to_listed_items(self):
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '90.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '90.00')
        self.assertEqual(str(self.item_b.price), '90.00')

    def test_bulk_update_returns_refreshed_order_with_recomputed_total(self):
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '50.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        # 2 * 50 + 3 * 50 = 250
        self.assertEqual(str(response.data['total']), '250.00')
        self.assertEqual(len(response.data['items']), 2)
        for item in response.data['items']:
            self.assertEqual(str(item['price']), '50.00')

    def test_bulk_update_silently_skips_ids_not_in_this_order(self):
        # An item from a *different* order in the same org — must NOT be touched.
        other_order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='Other',
        )
        other_item = PurchaseOrderItem.objects.create(
            order=other_order, sku='SKU2', price='999.00', quantity=1,
        )
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, other_item.id],
             'data': {'price': '11.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.item_a.refresh_from_db()
        other_item.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '11.00')
        self.assertEqual(str(other_item.price), '999.00')

    def test_discount_denial_rolls_back_whole_batch(self):
        # Make item_b pricier so the same discounted_price implies a much
        # larger discount on it. With cap=30: item_a's 20% passes (and is
        # save()'d), item_b's 60% is denied. Without atomic rollback,
        # item_a's discounted_price would persist as 80.00.
        self.item_b.price = '200.00'
        self.item_b.save()
        self.user.max_discount_percent = 30
        self.user.save()

        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'discounted_price': '80.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data['code'], 'DISCOUNT_EXCEEDS_LIMIT')
        # item_b is the one that exceeded the cap, so it's the failed_item_id.
        self.assertEqual(response.data['failed_item_id'], self.item_b.id)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        # item_a passed validation and was save()'d in iteration 1 — only
        # transaction.atomic() rolling back can keep its discounted_price None.
        self.assertIsNone(self.item_a.discounted_price)
        self.assertIsNone(self.item_b.discounted_price)

    def test_rejects_discounted_price_above_base(self):
        # Regression for ClickUp 86c9n9exd: setting `discounted_price` higher
        # than `price` previously slipped past the discount-cap check (since
        # it isn't a "discount") and inflated the line total via
        # PurchaseOrderItem.effective_price, producing invoices whose total
        # exceeded the product price. The validator now rejects it with 400.
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id],
             'data': {'discounted_price': '150.00', 'discount_percent': '0'}},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data['code'], 'DISCOUNTED_PRICE_ABOVE_BASE')
        self.item_a.refresh_from_db()
        self.assertIsNone(self.item_a.discounted_price)

    def test_other_org_order_returns_404(self):
        other_org = _make_organization(name='Other', identification_number='999')
        other_user = User.objects.create_user(
            username='outsider', password='p',
            role=User.Role.COMPANY_USER, organization=other_org,
        )
        other_client = APIClient()
        other_client.force_authenticate(user=other_user)
        response = other_client.patch(
            self.url,  # this points at self.org's order
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '1.00'}},
            format='json',
        )
        # PurchaseOrderViewSet.get_queryset filters by user.organization, so a
        # cross-org order is invisible (404), not a 403. Both items must be
        # untouched — neither id should ever reach the filter().
        self.assertEqual(response.status_code, 404)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '100.00')
        self.assertEqual(str(self.item_b.price), '100.00')

    def test_unit_only_change_does_not_trigger_discount_check(self):
        # Pre-existing 15% discount on item_a. Without the is_changing_discount
        # short-circuit, _enforce_discount_permission would be invoked with
        # the existing 15% and (since can_apply_discount=False) deny — so a
        # *unit-only* edit would 403, breaking routine line edits.
        self.item_a.discount_percent = '15.00'
        self.item_a.save()
        self.user.can_apply_discount = False
        self.user.save()

        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'unit': 'box'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(self.item_a.unit, 'box')
        self.assertEqual(self.item_b.unit, 'box')
        # The pre-existing discount must survive — we only touched unit.
        self.assertEqual(str(self.item_a.discount_percent), '15.00')


class PurchaseOrderRetailFieldTests(TestCase):
    def test_is_retail_defaults_false(self):
        org = _make_organization()
        order = PurchaseOrder.objects.create(organization=org)
        self.assertFalse(order.is_retail)


@override_settings(SECURE_SSL_REDIRECT=False)
class RetailOrderAPITests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='retail-u', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.url = reverse('order-list')

    def test_retail_order_created_without_customer_name(self):
        response = self.api.post(self.url, {'is_retail': True}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data['is_retail'])
        order = PurchaseOrder.objects.get(pk=response.data['id'])
        self.assertTrue(order.is_retail)
        self.assertEqual(order.customer_name, '')
        self.assertEqual(order.external_client_id, '')

    def test_non_retail_order_still_requires_customer_name(self):
        response = self.api.post(self.url, {'customer_phone': '555123456'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('customer_name', response.data)

    def test_retail_order_blanks_stray_customer_fields(self):
        response = self.api.post(
            self.url,
            {'is_retail': True, 'customer_name': 'Should Be Dropped',
             'customer_identification_number': '99999'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        order = PurchaseOrder.objects.get(pk=response.data['id'])
        self.assertEqual(order.customer_name, '')
        self.assertEqual(order.customer_identification_number, '')

    def test_two_retail_orders_are_distinct_drafts(self):
        r1 = self.api.post(self.url, {'is_retail': True}, format='json')
        r2 = self.api.post(self.url, {'is_retail': True}, format='json')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertNotEqual(r1.data['id'], r2.data['id'])

    def test_attaching_client_clears_retail_flag(self):
        created = self.api.post(self.url, {'is_retail': True}, format='json')
        order_id = created.data['id']
        detail_url = reverse('order-detail', kwargs={'pk': order_id})
        response = self.api.patch(
            detail_url,
            {'customer_name': 'Nino Beridze', 'is_retail': False},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        order = PurchaseOrder.objects.get(pk=order_id)
        self.assertFalse(order.is_retail)
        self.assertEqual(order.customer_name, 'Nino Beridze')

    def test_delivery_only_patch_on_normal_order_keeps_customer(self):
        created = self.api.post(self.url, {'customer_name': 'Giorgi Beridze'}, format='json')
        order_id = created.data['id']
        detail_url = reverse('order-detail', kwargs={'pk': order_id})
        response = self.api.patch(
            detail_url, {'delivery_notes': 'call before arriving'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['customer_name'], 'Giorgi Beridze')


@override_settings(SECURE_SSL_REDIRECT=False)
class RetailOrderListSerializerTests(TestCase):
    def test_list_response_includes_is_retail(self):
        org = _make_organization()
        user = User.objects.create_user(
            username='list-u', password='p',
            role=User.Role.COMPANY_USER, organization=org,
        )
        PurchaseOrder.objects.create(organization=org, created_by=user, is_retail=True)
        api = APIClient()
        api.force_authenticate(user)
        response = api.get(reverse('order-list'))
        self.assertEqual(response.status_code, 200)
        results = response.data['results'] if 'results' in response.data else response.data
        self.assertIn('is_retail', results[0])
        self.assertTrue(results[0]['is_retail'])


class InvoiceCustomerNameTokenTests(TestCase):
    def test_retail_order_resolves_to_georgian_retail_label(self):
        from core.services.invoice_tokens import TOKEN_CATALOG
        org = _make_organization()
        retail = PurchaseOrder.objects.create(organization=org, is_retail=True)
        normal = PurchaseOrder.objects.create(
            organization=org, customer_name='Nino Beridze',
        )
        resolver = TOKEN_CATALOG['order']['customer_name']
        self.assertEqual(resolver(retail), 'საცალო მომხმარებელი')
        self.assertEqual(resolver(normal), 'Nino Beridze')


class IsCompanyAdminOrInternalAdminTests(TestCase):
    def test_admins_allowed_company_user_blocked(self):
        from types import SimpleNamespace
        from core.permissions import IsCompanyAdminOrInternalAdmin
        org = _make_organization()
        company_admin = User.objects.create_user(
            username='ca-perm', password='p',
            role=User.Role.COMPANY_ADMIN, organization=org,
        )
        company_user = User.objects.create_user(
            username='cu-perm', password='p',
            role=User.Role.COMPANY_USER, organization=org,
        )
        perm = IsCompanyAdminOrInternalAdmin()
        self.assertTrue(perm.has_permission(SimpleNamespace(user=company_admin), None))
        self.assertFalse(perm.has_permission(SimpleNamespace(user=company_user), None))


@override_settings(SECURE_SSL_REDIRECT=False)
class OrderAnalyticsAPITests(TestCase):
    def setUp(self):
        self.org = _make_organization(name='OrgA', identification_number='111')
        self.other_org = _make_organization(name='OrgB', identification_number='222')
        self.admin = User.objects.create_user(
            username='ca', password='p',
            role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.c1 = User.objects.create_user(
            username='c1', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.c2 = User.objects.create_user(
            username='c2', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        # c1: 2 created (1 confirmed); c2: 1 created (0 confirmed)
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c1, customer_name='A', status='confirmed')
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c1, customer_name='B', status='draft')
        PurchaseOrder.objects.create(organization=self.org, created_by=self.c2, customer_name='C', status='cancelled')
        # Other org (must not leak to org A's admin)
        self.c3 = User.objects.create_user(
            username='c3', password='p',
            role=User.Role.COMPANY_USER, organization=self.other_org,
        )
        PurchaseOrder.objects.create(organization=self.other_org, created_by=self.c3, customer_name='D', status='confirmed')
        self.api = APIClient()
        self.url = reverse('order-analytics')

    def test_company_admin_sees_only_own_org(self):
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 200)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['orders_created'], 2)
        self.assertEqual(by_id[self.c1.id]['orders_confirmed'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_created'], 1)
        self.assertEqual(by_id[self.c2.id]['orders_confirmed'], 0)
        self.assertNotIn(self.c3.id, by_id)
        self.assertEqual(resp.data['totals']['orders_created'], 3)
        self.assertEqual(resp.data['totals']['orders_confirmed'], 1)

    def test_conversion_rate_math(self):
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertEqual(by_id[self.c1.id]['conversion_rate'], 0.5)
        self.assertEqual(by_id[self.c2.id]['conversion_rate'], 0.0)

    def test_company_user_forbidden(self):
        self.api.force_authenticate(self.c1)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 403)

    def test_internal_admin_filter_by_organization(self):
        internal = User.objects.create_user(
            username='ia', password='p', role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        self.api.force_authenticate(internal)
        resp = self.api.get(self.url, {'organization': self.other_org.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([c['username'] for c in resp.data['consultants']], ['c3'])

    def test_date_window_excludes_out_of_range(self):
        from datetime import datetime
        PurchaseOrder.objects.filter(created_by=self.c2).update(
            created_at=timezone.make_aware(datetime(2020, 1, 1, 12, 0)),
        )
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url)
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertNotIn(self.c2.id, by_id)

    def test_company_admin_cannot_escape_org_via_param(self):
        # Even if a company_admin passes ?organization=<other org>, the endpoint
        # must stay scoped to their OWN org (no cross-tenant leak).
        self.api.force_authenticate(self.admin)
        resp = self.api.get(self.url, {'organization': self.other_org.id})
        self.assertEqual(resp.status_code, 200)
        usernames = [c['username'] for c in resp.data['consultants']]
        self.assertNotIn('c3', usernames)            # other org NOT leaked
        by_id = {c['user_id']: c for c in resp.data['consultants']}
        self.assertIn(self.c1.id, by_id)             # own org still present

    def test_anonymous_forbidden(self):
        resp = APIClient().get(self.url)
        self.assertIn(resp.status_code, (401, 403))


class WebhookTokenTests(TestCase):
    def _org(self, name):
        return Organization.objects.create(
            name=name, identification_number=name, web_service_url="https://x", employees_count=5,
        )

    def test_tokens_are_autogenerated_and_unique(self):
        a, b = self._org("A"), self._org("B")
        self.assertTrue(a.webhook_token)
        self.assertNotEqual(a.webhook_token, b.webhook_token)

    def test_rotate_changes_token(self):
        a = self._org("A")
        old = a.webhook_token
        a.rotate_webhook_token()
        a.refresh_from_db()
        self.assertNotEqual(a.webhook_token, old)


from core.catalog import row_hash, proxy_image_paths


class CatalogHelperTests(TestCase):
    def test_row_hash_is_order_independent_for_barcodes(self):
        a = row_hash({"name": "X", "barcodes": ["1", "2"], "image_urls": [], "article": "", "price": "1"})
        b = row_hash({"name": "X", "barcodes": ["2", "1"], "image_urls": [], "article": "", "price": "1"})
        self.assertEqual(a, b)

    def test_row_hash_changes_on_name_change(self):
        a = row_hash({"name": "X", "barcodes": [], "image_urls": [], "article": "", "price": "1"})
        b = row_hash({"name": "Y", "barcodes": [], "image_urls": [], "article": "", "price": "1"})
        self.assertNotEqual(a, b)

    def test_proxy_image_paths(self):
        self.assertEqual(
            proxy_image_paths("S1", 2),
            ["catalog/products/S1/image/0/", "catalog/products/S1/image/1/"],
        )


from types import SimpleNamespace
from rest_framework.exceptions import AuthenticationFailed
from core.ingest_auth import organization_from_push


class PushAuthTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )

    def _req(self, headers):
        return SimpleNamespace(headers=headers)

    def test_resolves_org_from_x_webhook_token(self):
        got = organization_from_push(self._req({"X-Webhook-Token": self.org.webhook_token}))
        self.assertEqual(got, self.org)

    def test_resolves_org_from_bearer(self):
        got = organization_from_push(self._req({"Authorization": f"Bearer {self.org.webhook_token}"}))
        self.assertEqual(got, self.org)

    def test_missing_token_raises(self):
        with self.assertRaises(AuthenticationFailed):
            organization_from_push(self._req({}))

    def test_invalid_token_raises(self):
        with self.assertRaises(AuthenticationFailed):
            organization_from_push(self._req({"X-Webhook-Token": "nope"}))


@override_settings(SECURE_SSL_REDIRECT=False)
class IngestUpsertTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )
        self.url = "/api/v1/catalog/products/"

    def _push(self, products, is_full=False):
        return self.client.post(
            self.url, {"products": products, "is_full": is_full},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )

    def test_upsert_creates_rows_and_barcodes(self):
        r = self._push([{"sku": "S1", "name": "Candle", "barcodes": ["123", "456"], "image_urls": ["u"]}])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"received": 1, "upserted": 1, "skipped": 0})
        p = Product.objects.get(organization=self.org, sku="S1")
        self.assertEqual(set(p.barcodes.values_list("barcode", flat=True)), {"123", "456"})

    def test_repush_unchanged_is_skipped(self):
        payload = [{"sku": "S1", "name": "Candle", "barcodes": ["123"], "image_urls": []}]
        self._push(payload)
        r = self._push(payload)
        self.assertEqual(r.json(), {"received": 1, "upserted": 0, "skipped": 1})

    def test_reactivates_previously_deactivated(self):
        self._push([{"sku": "S1", "name": "Candle"}])
        Product.objects.filter(organization=self.org, sku="S1").update(is_active=False)
        self._push([{"sku": "S1", "name": "Candle 2"}])
        self.assertTrue(Product.objects.get(organization=self.org, sku="S1").is_active)

    def test_reactivates_on_identical_repush(self):
        payload = [{"sku": "S1", "name": "Candle", "barcodes": ["123"], "image_urls": []}]
        self._push(payload)
        Product.objects.filter(organization=self.org, sku="S1").update(is_active=False, deactivated_at=timezone.now())
        r = self._push(payload)  # identical payload, unchanged row_hash
        self.assertEqual(r.json(), {"received": 1, "upserted": 1, "skipped": 0})  # NOT skipped despite matching hash
        p = Product.objects.get(organization=self.org, sku="S1")
        self.assertTrue(p.is_active)
        self.assertIsNone(p.deactivated_at)

    def test_push_is_isolated_per_org(self):
        other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
        )
        self.client.post(
            self.url, {"products": [{"sku": "S1", "name": "A-candle"}]},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )
        self.client.post(
            self.url, {"products": [{"sku": "S1", "name": "B-candle"}]},
            format="json", HTTP_X_WEBHOOK_TOKEN=other.webhook_token,
        )
        self.assertEqual(Product.objects.get(organization=self.org, sku="S1").name, "A-candle")
        self.assertEqual(Product.objects.get(organization=other, sku="S1").name, "B-candle")

    def test_bad_token_rejected(self):
        r = self.client.post(self.url, {"products": []}, format="json", HTTP_X_WEBHOOK_TOKEN="nope")
        self.assertIn(r.status_code, (401, 403))

    def test_full_push_sets_watermark(self):
        self._push([{"sku": "S1", "name": "Candle"}], is_full=True)
        st = CatalogIngestState.objects.get(organization=self.org)
        self.assertIsNotNone(st.last_full_push_at)


@override_settings(SECURE_SSL_REDIRECT=False)
class IngestDeactivateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )
        Product.objects.create(organization=self.org, sku="S1", name="Candle")

    def test_deactivate_sets_flags(self):
        r = self.client.post(
            "/api/v1/catalog/products/deactivate/", {"skus": ["S1"]},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"deactivated": 1})
        p = Product.objects.get(organization=self.org, sku="S1")
        self.assertFalse(p.is_active)
        self.assertIsNotNone(p.deactivated_at)

    def test_deactivate_is_isolated_per_org(self):
        other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
        )
        Product.objects.create(organization=other, sku="S1", name="Other Candle")
        r = self.client.post(
            "/api/v1/catalog/products/deactivate/", {"skus": ["S1"]},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )
        self.assertEqual(r.json(), {"deactivated": 1})
        self.assertTrue(Product.objects.get(organization=other, sku="S1").is_active)
        self.assertIsNone(Product.objects.get(organization=other, sku="S1").deactivated_at)


@override_settings(SECURE_SSL_REDIRECT=False)
class ImageProxyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x",
            web_service_username="u", employees_count=5,
        )
        self.other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
        )
        self.user = User.objects.create_user(
            username="c", password="p", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client.force_authenticate(self.user)
        self.product = Product.objects.create(
            organization=self.org, sku="S1", name="Candle", image_urls=["http://1c/img0.jpg"],
        )

    @mock.patch("core.views.httpx.get")
    def test_proxies_first_image(self, mget):
        mget.return_value = mock.Mock(status_code=200, content=b"JPEGBYTES", headers={"Content-Type": "image/jpeg"})
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 0)
        with mock.patch("core.views.assert_safe_image_url", return_value=None):
            r = self.client.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, b"JPEGBYTES")
        self.assertIn("immutable", r["Cache-Control"])
        self.assertEqual(r["X-Content-Type-Options"], "nosniff")
        self.assertIn("inline", r["Content-Disposition"])
        self.assertIn("default-src 'none'", r["Content-Security-Policy"])

    def test_out_of_range_idx_404(self):
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 9)
        r = self.client.get(url)
        self.assertEqual(r.status_code, 404)

    def test_other_orgs_product_404(self):
        Product.objects.create(organization=self.other, sku="S2", name="X", image_urls=["http://1c/x.jpg"])
        url = "/api/v1/" + signed_image_path(self.org.id, "S2", 0)
        r = self.client.get(url)
        self.assertEqual(r.status_code, 404)

    def test_blocked_url_returns_502(self):
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 0)
        with mock.patch("core.views.assert_safe_image_url", side_effect=UnsafeImageURL("blocked")):
            r = self.client.get(url)
        self.assertEqual(r.status_code, 502)

    def test_unsigned_request_is_forbidden(self):
        r = self.client.get("/api/v1/catalog/products/S1/image/0/")  # no org/sig
        self.assertEqual(r.status_code, 403)

    @mock.patch("core.views.httpx.get")
    def test_sends_org_auth_only_to_matching_host(self, mget):
        # image host == web_service_url host -> auth attached
        self.org.web_service_url = "https://imghost.example"
        self.org.web_service_username = "u"
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        try:
            self.org.encrypt_password("pw")
        finally:
            os.environ.pop('FERNET_KEY', None)
        self.org.save()
        self.product.image_urls = ["https://imghost.example/a.jpg"]
        self.product.save()
        mget.return_value = mock.Mock(status_code=200, content=b"X", headers={"Content-Type": "image/jpeg"})
        url = "/api/v1/" + signed_image_path(self.org.id, "S1", 0)
        os.environ['FERNET_KEY'] = _TEST_FERNET_KEY
        try:
            with mock.patch("core.views.assert_safe_image_url", return_value=None):
                self.client.get(url)
        finally:
            os.environ.pop('FERNET_KEY', None)
        _, kwargs = mget.call_args
        self.assertEqual(kwargs.get("auth"), ("u", "pw"))


class SignedImageUrlTests(TestCase):
    def test_path_contains_org_and_sig(self):
        p = signed_image_path(7, "S1", 0)
        self.assertTrue(p.startswith("catalog/products/S1/image/0/?org=7&sig="))

    def test_verify_roundtrip(self):
        sig = _sig(7, "S1", 0)
        self.assertTrue(verify_image_sig(7, "S1", 0, sig))

    def test_verify_rejects_wrong_org(self):
        sig = _sig(7, "S1", 0)               # signed for org 7
        self.assertFalse(verify_image_sig(8, "S1", 0, sig))  # can't reuse for org 8

    def test_verify_rejects_tampered_idx_and_missing_sig(self):
        sig = _sig(7, "S1", 0)
        self.assertFalse(verify_image_sig(7, "S1", 1, sig))
        self.assertFalse(verify_image_sig(7, "S1", 0, None))

    def test_paths_count(self):
        self.assertEqual(len(signed_image_paths(7, "S1", 3)), 3)


class ImageProxySafetyTests(TestCase):
    def _addrinfo(self, ip):
        return [(2, 1, 6, "", (ip, 443))]

    def test_rejects_non_https(self):
        with self.assertRaises(UnsafeImageURL):
            assert_safe_image_url("http://example.com/a.jpg")

    def test_rejects_private_address(self):
        with mock.patch("core.image_proxy_safety.socket.getaddrinfo", return_value=self._addrinfo("10.0.0.5")):
            with self.assertRaises(UnsafeImageURL):
                assert_safe_image_url("https://internal.example/a.jpg")

    def test_rejects_loopback_and_metadata(self):
        for ip in ("127.0.0.1", "169.254.169.254"):
            with mock.patch("core.image_proxy_safety.socket.getaddrinfo", return_value=self._addrinfo(ip)):
                with self.assertRaises(UnsafeImageURL):
                    assert_safe_image_url("https://x.example/a.jpg")

    def test_allows_public_address(self):
        with mock.patch("core.image_proxy_safety.socket.getaddrinfo", return_value=self._addrinfo("93.184.216.34")):
            assert_safe_image_url("https://example.com/a.jpg")  # no raise

    def test_content_type_allowlist(self):
        self.assertEqual(sanitized_image_content_type("image/png"), "image/png")
        self.assertEqual(sanitized_image_content_type("image/jpeg; charset=binary"), "image/jpeg")
        self.assertIsNone(sanitized_image_content_type("image/svg+xml"))
        self.assertIsNone(sanitized_image_content_type("text/html"))
        self.assertIsNone(sanitized_image_content_type(None))


@override_settings(SECURE_SSL_REDIRECT=False)
class NameSearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )
        self.other = Organization.objects.create(
            name="Other", identification_number="ORG2", web_service_url="https://y", employees_count=5,
        )
        self.user = User.objects.create_user(
            username="c", password="p", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client.force_authenticate(self.user)
        Product.objects.create(organization=self.org, sku="S1", name="Candle decorative", image_urls=["u"])
        Product.objects.create(organization=self.org, sku="S2", name="Table", is_active=False)
        Product.objects.create(organization=self.other, sku="S3", name="Candle other-org")

    def test_finds_active_own_org_only(self):
        r = self.client.get("/api/v1/catalog/products/search/?q=candle")
        self.assertEqual(r.status_code, 200)
        skus = {row["sku"] for row in r.json()}
        self.assertEqual(skus, {"S1"})  # not the inactive one, not the other org's

    def test_first_image_is_proxy_path(self):
        r = self.client.get("/api/v1/catalog/products/search/?q=candle")
        self.assertEqual(r.json()[0]["image"], signed_image_path(self.org.id, "S1", 0))

    def test_empty_query_returns_empty(self):
        self.assertEqual(self.client.get("/api/v1/catalog/products/search/?q=").json(), [])

    def test_inactive_matching_product_is_excluded(self):
        Product.objects.create(organization=self.org, sku="S4", name="Candle inactive", is_active=False)
        r = self.client.get("/api/v1/catalog/products/search/?q=candle")
        self.assertEqual(r.status_code, 200)
        skus = {row["sku"] for row in r.json()}
        self.assertIn("S1", skus)       # active match present
        self.assertNotIn("S4", skus)    # inactive match excluded by is_active filter, NOT by name


@override_settings(SECURE_SSL_REDIRECT=False)
class ScanFastPathTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )
        self.user = User.objects.create_user(
            username="c", password="p", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client.force_authenticate(self.user)
        p = Product.objects.create(
            organization=self.org, sku="S1", name="Candle", price="9.90", image_urls=["http://1c/a.jpg"],
        )
        ProductBarcode.objects.create(product=p, barcode="123")

    @mock.patch("core.views.ConsultWebExchangeClient.get_stock_and_prices")
    def test_replica_hit_returns_proxy_images_and_live_stock(self, mstock):
        mstock.return_value = {"stock": [{"warehouse": "W1", "warehouse_name": "Main", "quantity": 3, "price": "9.90"}]}
        r = self.client.post(
            "/api/v1/product/search/", {"sku": "123", "is_barcode": True, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["sku_name"], "Candle")
        self.assertEqual(body["images"], [signed_image_path(self.org.id, "S1", 0)])
        self.assertEqual(body["stock"][0]["quantity"], 3)

    @mock.patch("core.views.ConsultWebExchangeClient.get_stock_and_prices")
    def test_stock_failure_degrades_gracefully(self, mstock):
        mstock.side_effect = ConsultWebExchangeError(code="EXTERNAL_SERVICE_TIMEOUT", detail="t", http_status=504)
        r = self.client.post(
            "/api/v1/product/search/", {"sku": "123", "is_barcode": True, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["stock_status"], "unavailable")


from io import StringIO
from django.core.management import call_command


class StalenessCommandTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )

    def test_marks_stale_org(self):
        CatalogIngestState.objects.create(organization=self.org)  # never pushed → stale
        out = StringIO()
        call_command("check_catalog_staleness", stdout=out)
        self.org.catalog_ingest_state.refresh_from_db()
        self.assertEqual(self.org.catalog_ingest_state.status, "stale")
        self.assertIn("Org", out.getvalue())


@override_settings(SECURE_SSL_REDIRECT=False)
class IntegrationDocsTests(TestCase):
    """The /api/integration/ schema is filtered to only the external ingest endpoints."""

    def test_integration_schema_contains_only_ingest_endpoints(self):
        r = self.client.get("/api/integration/schema/?format=json")
        self.assertEqual(r.status_code, 200)
        paths = set(r.json()["paths"].keys())
        self.assertEqual(
            paths,
            {"/api/v1/catalog/products/", "/api/v1/catalog/products/deactivate/"},
        )

    def test_integration_schema_documents_request_body_and_token_header(self):
        post = self.client.get("/api/integration/schema/?format=json").json()[
            "paths"]["/api/v1/catalog/products/"]["post"]
        self.assertIn("requestBody", post)
        param_names = {p["name"] for p in post.get("parameters", [])}
        self.assertIn("X-Webhook-Token", param_names)

    def test_integration_schema_tag_list_is_scoped(self):
        # ReDoc renders top-level tags as nav sections — the integration schema
        # must not carry the internal API's tags (Users, Organizations, …).
        schema = self.client.get("/api/integration/schema/?format=json").json()
        tag_names = {t["name"] for t in schema.get("tags", [])}
        self.assertEqual(tag_names, {"Catalog Ingest"})

    def test_integration_redoc_renders(self):
        self.assertEqual(self.client.get("/api/integration/redoc/").status_code, 200)

    def test_main_schema_is_not_filtered(self):
        paths = self.client.get("/api/schema/?format=json").json()["paths"]
        # an internal, non-ingest endpoint stays in the full schema
        self.assertIn("/api/v1/product/search/", paths)


@override_settings(SECURE_SSL_REDIRECT=False)
class ExternalServiceTokenTests(TestCase):
    """Company admins can view and rotate their org's catalog-push token."""

    EXT = "/api/v1/organizations/my-organization/external-service/"
    ROTATE = "/api/v1/organizations/my-organization/external-service/rotate-token/"

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )
        self.admin = User.objects.create_user(
            username="admin", password="p", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.member = User.objects.create_user(
            username="u", password="p", role=User.Role.COMPANY_USER, organization=self.org,
        )

    def test_admin_sees_webhook_token(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(self.EXT)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["webhook_token"], self.org.webhook_token)

    def test_admin_can_rotate_and_old_token_stops_working(self):
        self.client.force_authenticate(self.admin)
        old = self.org.webhook_token
        r = self.client.post(self.ROTATE)
        self.assertEqual(r.status_code, 200)
        new = r.json()["webhook_token"]
        self.assertNotEqual(new, old)
        self.org.refresh_from_db()
        self.assertEqual(self.org.webhook_token, new)
        # the old token no longer authenticates a push
        r2 = self.client.post(
            "/api/v1/catalog/products/", {"products": []}, format="json", HTTP_X_WEBHOOK_TOKEN=old,
        )
        self.assertIn(r2.status_code, (401, 403))

    def test_company_user_cannot_rotate(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(self.ROTATE).status_code, 403)


@override_settings(SECURE_SSL_REDIRECT=False)
class PushIPAllowlistTests(TestCase):
    """Optional per-org source-IP allowlist for the catalog push token."""

    EXT = "/api/v1/organizations/my-organization/external-service/"

    def setUp(self):
        self.client = APIClient()
        self.org = Organization.objects.create(
            name="Org", identification_number="ORG1", web_service_url="https://x", employees_count=5,
        )
        self.url = "/api/v1/catalog/products/"

    def _push(self, remote_addr):
        return self.client.post(
            self.url, {"products": []}, format="json",
            HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token, REMOTE_ADDR=remote_addr,
        )

    def test_no_allowlist_allows_any_ip(self):
        self.assertEqual(self._push("203.0.113.9").status_code, 200)

    def test_allowlisted_cidr_passes(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.0/24")
        self.assertEqual(self._push("203.0.113.9").status_code, 200)

    def test_non_allowlisted_ip_forbidden(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.0/24")
        self.assertEqual(self._push("198.51.100.7").status_code, 403)

    def test_x_forwarded_for_first_hop_is_used(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.9")
        r = self.client.post(
            self.url, {"products": []}, format="json",
            HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
            HTTP_X_FORWARDED_FOR="203.0.113.9, 10.0.0.1", REMOTE_ADDR="10.0.0.1",
        )
        self.assertEqual(r.status_code, 200)

    def _admin(self):
        admin = User.objects.create_user(
            username="a", password="p", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.client.force_authenticate(admin)
        return admin

    def test_admin_can_set_and_read_allowlist(self):
        self._admin()
        r = self.client.patch(self.EXT, {"push_allowed_ips": ["203.0.113.0/24", "198.51.100.7"]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.json()["push_allowed_ips"]), {"203.0.113.0/24", "198.51.100.7"})
        # …and it is now enforced
        self.client.force_authenticate(user=None)
        self.assertEqual(self._push("10.10.10.10").status_code, 403)

    def test_empty_list_clears_allowlist(self):
        OrganizationPushAllowedIP.objects.create(organization=self.org, ip_or_network="203.0.113.0/24")
        self._admin()
        r = self.client.patch(self.EXT, {"push_allowed_ips": []}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["push_allowed_ips"], [])

    def test_invalid_entry_rejected(self):
        self._admin()
        r = self.client.patch(self.EXT, {"push_allowed_ips": ["not-an-ip"]}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "INVALID_IP")


from django.db import IntegrityError, transaction
from core.models import (
    Organization, Warehouse, Product, ProductBarcode, ProductCategory,
    ProductAttribute, CatalogIngestState,
)


class CatalogCategoryModelTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )

    def test_category_unique_per_org(self):
        ProductCategory.objects.create(organization=self.org, external_id="7", name="Cookware")
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProductCategory.objects.create(organization=self.org, external_id="7", name="Dup")

    def test_product_gains_category_and_attributes(self):
        p = Product.objects.create(organization=self.org, sku="A-1", name="X")
        self.assertEqual(p.attributes, {})
        self.assertIsNone(p.category)

    def test_attribute_unique_per_org(self):
        ProductAttribute.objects.create(organization=self.org, key="color")
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProductAttribute.objects.create(organization=self.org, key="color")


class CategoryChainHelperTests(TestCase):
    def test_normalize_cleans_and_stringifies(self):
        chain = [{"id": 7, "name": " Cookware "}, {"id": "42", "name": "Pans"}]
        self.assertEqual(
            normalize_category_chain(chain),
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}],
        )

    def test_normalize_none_on_empty_or_missing(self):
        self.assertIsNone(normalize_category_chain([]))
        self.assertIsNone(normalize_category_chain(None))
        self.assertIsNone(normalize_category_chain("nope"))

    def test_normalize_none_on_duplicate_id_cycle(self):
        self.assertIsNone(normalize_category_chain([{"id": "7", "name": "A"}, {"id": "7", "name": "B"}]))

    def test_normalize_none_on_missing_id(self):
        self.assertIsNone(normalize_category_chain([{"name": "NoId"}]))

    def test_path_ids_string(self):
        chain = [{"id": "7", "name": "C"}, {"id": "42", "name": "P"}]
        self.assertEqual(path_ids_string(chain), "/7/42/")

    def test_path_names(self):
        chain = [{"id": "7", "name": "C"}, {"id": "42", "name": "P"}]
        self.assertEqual(path_names(chain), ["C", "P"])

    def test_normalize_keeps_present_falsy_id(self):
        self.assertEqual(
            normalize_category_chain([{"id": 0, "name": "Root"}]),
            [{"id": "0", "name": "Root"}],
        )

    def test_normalize_none_on_blank_id(self):
        self.assertIsNone(normalize_category_chain([{"id": "  ", "name": "X"}]))

    def test_path_names_empty_is_safe(self):
        self.assertEqual(path_names([]), [])
        self.assertEqual(path_names(None), [])


from core.catalog import row_hash


class RowHashCategoryAttributeTests(TestCase):
    def test_attribute_only_change_changes_hash(self):
        a = {"sku": "A", "name": "N", "attributes": {"color": "red"}}
        b = {"sku": "A", "name": "N", "attributes": {"color": "blue"}}
        self.assertNotEqual(row_hash(a), row_hash(b))

    def test_attribute_key_order_is_stable(self):
        a = {"attributes": {"a": "1", "b": "2"}}
        b = {"attributes": {"b": "2", "a": "1"}}
        self.assertEqual(row_hash(a), row_hash(b))

    def test_category_rename_changes_hash(self):
        a = {"category": [{"id": "7", "name": "Cookware"}]}
        b = {"category": [{"id": "7", "name": "Pots"}]}
        self.assertNotEqual(row_hash(a), row_hash(b))

    def test_reparent_changes_hash(self):
        a = {"category": [{"id": "7", "name": "Cookware"}]}
        b = {"category": [{"id": "9", "name": "Cookware"}]}
        self.assertNotEqual(row_hash(a), row_hash(b))

    def test_legacy_item_without_new_fields_still_hashes(self):
        self.assertTrue(row_hash({"sku": "A", "name": "N"}))

    def test_category_id_and_name_are_normalized(self):
        # 1C type/whitespace drift must not flip the fingerprint: int 7 vs "7",
        # " Pans " vs "Pans" hash identically (the stored node is normalized too).
        raw = {"category": [{"id": 7, "name": " Pans "}]}
        clean = {"category": [{"id": "7", "name": "Pans"}]}
        self.assertEqual(row_hash(raw), row_hash(clean))


from core.category_ingest import CategoryResolver


class CategoryResolverTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.org2 = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )

    def test_builds_full_chain(self):
        leaf = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        self.assertEqual(leaf.external_id, "42")
        self.assertEqual(leaf.path, "/7/42/")
        self.assertEqual(leaf.path_names, ["Cookware", "Pans"])
        root = ProductCategory.objects.get(organization=self.org, external_id="7")
        self.assertIsNone(root.parent)
        self.assertEqual(leaf.parent_id, root.id)
        self.assertEqual(ProductCategory.objects.filter(organization=self.org).count(), 2)

    def test_memoized_no_duplicate_ancestor(self):
        r = CategoryResolver(self.org)
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}])
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "99", "name": "Pots"}])
        self.assertEqual(ProductCategory.objects.filter(organization=self.org, external_id="7").count(), 1)
        self.assertEqual(ProductCategory.objects.filter(organization=self.org).count(), 3)

    def test_rename_refreshes_descendant_not_in_chain(self):
        r = CategoryResolver(self.org)
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}])
        r.resolve([{"id": "7", "name": "Cookware"}, {"id": "55", "name": "Woks"}])
        # A later push renames ancestor 7 while carrying only the 42 branch.
        CategoryResolver(self.org).resolve([{"id": "7", "name": "Kitchen"}, {"id": "42", "name": "Pans"}])
        node55 = ProductCategory.objects.get(organization=self.org, external_id="55")
        self.assertEqual(node55.path_names, ["Kitchen", "Woks"])  # healed via subtree refresh
        node42 = ProductCategory.objects.get(organization=self.org, external_id="42")
        self.assertEqual(node42.path_names, ["Kitchen", "Pans"])

    def test_cycle_returns_none_and_creates_nothing(self):
        leaf = CategoryResolver(self.org).resolve([{"id": "7", "name": "A"}, {"id": "7", "name": "B"}])
        self.assertIsNone(leaf)
        self.assertEqual(ProductCategory.objects.count(), 0)

    def test_same_id_isolated_across_orgs(self):
        CategoryResolver(self.org).resolve([{"id": "7", "name": "Cookware"}])
        CategoryResolver(self.org2).resolve([{"id": "7", "name": "Electronics"}])
        self.assertEqual(ProductCategory.objects.filter(external_id="7").count(), 2)
        self.assertEqual(ProductCategory.objects.get(organization=self.org, external_id="7").name, "Cookware")
        self.assertEqual(ProductCategory.objects.get(organization=self.org2, external_id="7").name, "Electronics")

    def test_create_race_refetches_existing_node(self):
        from unittest import mock
        from django.db.models.query import QuerySet
        ProductCategory.objects.create(
            organization=self.org, external_id="7", name="Cookware",
            path="/7/", path_names=["Cookware"],
        )
        original_first = QuerySet.first
        calls = {"n": 0}
        def flaky_first(qs):
            calls["n"] += 1
            if calls["n"] == 1:  # resolver's initial lookup "misses"
                return None
            return original_first(qs)
        with mock.patch.object(QuerySet, "first", flaky_first):
            leaf = CategoryResolver(self.org).resolve([{"id": "7", "name": "Cookware"}])
        self.assertEqual(leaf.external_id, "7")
        self.assertEqual(
            ProductCategory.objects.filter(organization=self.org, external_id="7").count(), 1,
        )


from core.attributes import (
    humanize_key, infer_type, project_attributes,
    MAX_ATTRIBUTE_KEYS_PER_ORG, MAX_ATTRIBUTE_KEY_LEN,
)
from core.attribute_ingest import register_attribute_keys


class AttributeHelperTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )

    def test_humanize_key(self):
        self.assertEqual(humanize_key("diameter_cm"), "Diameter Cm")

    def test_infer_type(self):
        self.assertEqual(infer_type(True), "boolean")
        self.assertEqual(infer_type(3), "number")
        self.assertEqual(infer_type(1.5), "number")
        self.assertEqual(infer_type("x"), "text")
        self.assertEqual(infer_type({"a": 1}), "json")

    def test_project_includes_only_visible_keys_in_order(self):
        ProductAttribute.objects.create(organization=self.org, key="color", label="Color", is_visible=True, order=0)
        visible = list(ProductAttribute.objects.filter(organization=self.org, is_visible=True).order_by("order", "key"))
        out = project_attributes({"color": "red", "cost_price": "9"}, visible)
        self.assertEqual(out, [{"key": "color", "label": "Color", "value": "red"}])


class AttributeRegistrationTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )

    def test_registers_hidden_with_inferred_type(self):
        register_attribute_keys(self.org, ["color", "weight"], {"color": "red", "weight": 1})
        color = ProductAttribute.objects.get(organization=self.org, key="color")
        self.assertFalse(color.is_visible)
        self.assertEqual(color.label, "Color")
        self.assertEqual(ProductAttribute.objects.get(organization=self.org, key="weight").type, "number")

    def test_idempotent(self):
        register_attribute_keys(self.org, ["color"], {"color": "red"})
        register_attribute_keys(self.org, ["color"], {"color": "blue"})
        self.assertEqual(ProductAttribute.objects.filter(organization=self.org, key="color").count(), 1)

    def test_respects_key_cap(self):
        keys = [f"k{i}" for i in range(MAX_ATTRIBUTE_KEYS_PER_ORG + 10)]
        register_attribute_keys(self.org, keys)
        self.assertEqual(ProductAttribute.objects.filter(organization=self.org).count(), MAX_ATTRIBUTE_KEYS_PER_ORG)

    def test_skips_overlong_key(self):
        register_attribute_keys(self.org, ["x" * (MAX_ATTRIBUTE_KEY_LEN + 1)])
        self.assertEqual(ProductAttribute.objects.filter(organization=self.org).count(), 0)


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogIngestCategoryAttributeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.api = APIClient()
        self.url = reverse("catalog-product-ingest")

    def _push(self, products, is_full=False):
        return self.api.post(
            self.url, {"products": products, "is_full": is_full},
            format="json", HTTP_X_WEBHOOK_TOKEN=self.org.webhook_token,
        )

    def test_push_creates_category_and_stores_attributes(self):
        resp = self._push([{
            "sku": "A-1", "name": "Pan",
            "category": [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}],
            "attributes": {"color": "black"},
        }])
        self.assertEqual(resp.status_code, 200)
        p = Product.objects.get(organization=self.org, sku="A-1")
        self.assertEqual(p.category.external_id, "42")
        self.assertEqual(p.attributes, {"color": "black"})
        reg = ProductAttribute.objects.get(organization=self.org, key="color")
        self.assertFalse(reg.is_visible)

    def test_reparent_is_not_skipped(self):
        self._push([{"sku": "A-1", "name": "Pan", "category": [{"id": "7", "name": "Cookware"}]}])
        resp = self._push([{"sku": "A-1", "name": "Pan", "category": [{"id": "9", "name": "Bakeware"}]}])
        self.assertEqual(resp.json()["upserted"], 1)
        self.assertEqual(Product.objects.get(organization=self.org, sku="A-1").category.external_id, "9")

    def test_attribute_only_change_is_not_skipped(self):
        self._push([{"sku": "A-1", "name": "Pan", "attributes": {"color": "red"}}])
        resp = self._push([{"sku": "A-1", "name": "Pan", "attributes": {"color": "blue"}}])
        self.assertEqual(resp.json()["upserted"], 1)
        self.assertEqual(Product.objects.get(organization=self.org, sku="A-1").attributes, {"color": "blue"})

    def test_unchanged_push_is_skipped(self):
        item = {"sku": "A-1", "name": "Pan", "attributes": {"color": "red"},
                "category": [{"id": "7", "name": "Cookware"}]}
        self._push([item])
        resp = self._push([item])
        self.assertEqual(resp.json()["skipped"], 1)

    def test_cycle_chain_stores_product_uncategorized_without_aborting(self):
        resp = self._push([{"sku": "A-1", "name": "Pan", "category": [{"id": "7", "name": "A"}, {"id": "7", "name": "B"}]}])
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(Product.objects.get(organization=self.org, sku="A-1").category)


from unittest.mock import patch


@override_settings(SECURE_SSL_REDIRECT=False)
class ScanResponseCategoryAttributeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.user = User.objects.create_user(
            username="u1", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.wh = Warehouse.objects.create(organization=self.org, name="Main", code="W1")
        self.wh.users.add(self.user)
        cat = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        self.product = Product.objects.create(
            organization=self.org, sku="A-1", name="Pan", category=cat,
            attributes={"color": "black", "cost_price": "9"},
        )
        ProductAttribute.objects.create(organization=self.org, key="color", label="Color", is_visible=True, order=0)
        ProductAttribute.objects.create(organization=self.org, key="cost_price", label="Cost", is_visible=False, order=1)
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    @patch("core.views.ConsultWebExchangeClient.get_stock_and_prices", return_value={"stock": []})
    def test_scan_returns_breadcrumb_and_only_visible_attributes(self, _mock):
        resp = self.api.post(
            reverse("product-search"),
            {"sku": "A-1", "is_barcode": False, "warehouses": ["W1"]}, format="json",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["category_path"], ["Cookware", "Pans"])
        self.assertEqual(data["attributes"], [{"key": "color", "label": "Color", "value": "black"}])

    def test_name_search_returns_breadcrumb(self):
        resp = self.api.get(reverse("catalog-product-search"), {"q": "Pan"})
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertEqual(rows[0]["category_path"], ["Cookware", "Pans"])


class CatalogAdminRegistrationTests(TestCase):
    def test_new_models_are_registered(self):
        from django.contrib import admin as dj_admin
        self.assertIn(ProductCategory, dj_admin.site._registry)
        self.assertIn(ProductAttribute, dj_admin.site._registry)

    def test_attribute_admin_allows_editing_visibility(self):
        from django.contrib import admin as dj_admin
        model_admin = dj_admin.site._registry[ProductAttribute]
        self.assertIn("is_visible", model_admin.list_editable)


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogSyncStatusTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.admin = User.objects.create_user(
            username="admin_a", password="pw", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        self.url = reverse("catalog-sync-status")

    def test_never_synced_returns_default(self):
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["health"], "never")
        self.assertFalse(data["has_synced"])
        self.assertEqual(data["active_product_count"], 0)
        self.assertEqual(data["stale_after_days"], 2)

    def test_populated_state_is_ok(self):
        Product.objects.create(organization=self.org, sku="A-1", name="Pan", is_active=True)
        CatalogIngestState.objects.create(
            organization=self.org, status="ok", last_delta_push_at=timezone.now(),
            received=10, upserted=3,
        )
        data = self.api.get(self.url).json()
        self.assertEqual(data["health"], "ok")
        self.assertTrue(data["has_synced"])
        self.assertEqual(data["received"], 10)
        self.assertEqual(data["active_product_count"], 1)

    def test_stale_when_last_push_old(self):
        CatalogIngestState.objects.create(
            organization=self.org, status="ok",
            last_delta_push_at=timezone.now() - timezone.timedelta(days=3),
        )
        data = self.api.get(self.url).json()
        self.assertTrue(data["is_stale"])
        self.assertEqual(data["health"], "stale")

    def test_error_status_maps_to_error_health(self):
        CatalogIngestState.objects.create(
            organization=self.org, status="error", last_error="boom",
            last_delta_push_at=timezone.now(),
        )
        data = self.api.get(self.url).json()
        self.assertEqual(data["health"], "error")
        self.assertEqual(data["last_error"], "boom")

    def test_company_user_forbidden(self):
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        self.assertEqual(api.get(self.url).status_code, 403)

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        CatalogIngestState.objects.create(organization=org_b, status="error", last_error="B only")
        data = self.api.get(self.url).json()
        # Org A has no state row of its own → never synced, and never sees B's error.
        self.assertEqual(data["health"], "never")
        self.assertEqual(data["last_error"], "")


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogProductListTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.admin = User.objects.create_user(
            username="admin_a", password="pw", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        self.url = reverse("catalog-product-list")

    def test_pagination_envelope(self):
        for i in range(30):
            Product.objects.create(organization=self.org, sku=f"S-{i:02d}", name=f"Item {i:02d}")
        data = self.api.get(self.url).json()
        self.assertEqual(data["count"], 30)
        self.assertEqual(len(data["results"]), 25)  # default page_size
        self.assertIsNotNone(data["next"])

    def test_search_matches_name_sku_barcode(self):
        p = Product.objects.create(organization=self.org, sku="PAN-1", name="Frying pan")
        ProductBarcode.objects.create(product=p, barcode="4860001234567")
        Product.objects.create(organization=self.org, sku="POT-1", name="Stock pot")
        self.assertEqual(self.api.get(self.url, {"q": "pan"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url, {"q": "POT-1"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url, {"q": "4860001234567"}).json()["count"], 1)

    def test_is_active_filter(self):
        Product.objects.create(organization=self.org, sku="A", name="Active", is_active=True)
        Product.objects.create(organization=self.org, sku="B", name="Gone", is_active=False)
        self.assertEqual(self.api.get(self.url, {"is_active": "false"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url, {"is_active": "true"}).json()["count"], 1)
        self.assertEqual(self.api.get(self.url).json()["count"], 2)

    def test_row_shape_and_attribute_projection(self):
        cat = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        p = Product.objects.create(
            organization=self.org, sku="A-1", name="Pan", category=cat,
            image_urls=["https://1c.example/img.jpg"],
            attributes={"color": "black", "cost_price": "9"},
        )
        ProductBarcode.objects.create(product=p, barcode="111")
        ProductAttribute.objects.create(organization=self.org, key="color", label="Color", is_visible=True, order=0)
        ProductAttribute.objects.create(organization=self.org, key="cost_price", label="Cost", is_visible=False, order=1)
        row = self.api.get(self.url).json()["results"][0]
        self.assertEqual(row["category_path"], ["Cookware", "Pans"])
        self.assertEqual(row["barcodes"], ["111"])
        self.assertEqual(len(row["images"]), 1)
        self.assertEqual(row["attributes"], [{"key": "color", "label": "Color", "value": "black"}])

    def test_uncategorized_product_has_empty_path(self):
        Product.objects.create(organization=self.org, sku="A-1", name="Pan")
        self.assertEqual(self.api.get(self.url).json()["results"][0]["category_path"], [])

    def test_company_user_forbidden(self):
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        self.assertEqual(api.get(self.url).status_code, 403)

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        Product.objects.create(organization=org_b, sku="B-1", name="Other org product")
        self.assertEqual(self.api.get(self.url).json()["count"], 0)


@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogCategoryTreeTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.admin = User.objects.create_user(
            username="admin_a", password="pw", role=User.Role.COMPANY_ADMIN, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        self.url = reverse("catalog-category-tree")
        # Cookware > Pans, Cookware > Pots, and a root sibling Textiles
        self.pans = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "42", "name": "Pans"}]
        )
        self.pots = CategoryResolver(self.org).resolve(
            [{"id": "7", "name": "Cookware"}, {"id": "43", "name": "Pots"}]
        )
        self.textiles = CategoryResolver(self.org).resolve([{"id": "9", "name": "Textiles"}])

    def test_tree_shape_and_rollup_counts(self):
        Product.objects.create(organization=self.org, sku="P1", name="Pan", category=self.pans, is_active=True)
        Product.objects.create(organization=self.org, sku="P2", name="Pot", category=self.pots, is_active=True)
        Product.objects.create(organization=self.org, sku="P3", name="Old pan", category=self.pans, is_active=False)
        resp = self.api.get(self.url)
        self.assertEqual(resp.status_code, 200)
        roots = resp.json()
        self.assertEqual([r["name"] for r in roots], ["Cookware", "Textiles"])
        cookware = roots[0]
        self.assertEqual(cookware["product_count"], 2)  # rolled up, inactive excluded
        self.assertEqual([c["name"] for c in cookware["children"]], ["Pans", "Pots"])
        self.assertEqual(cookware["children"][0]["product_count"], 1)
        self.assertEqual(roots[1]["product_count"], 0)

    def test_company_user_allowed(self):
        user = User.objects.create_user(
            username="u_a", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        api = APIClient()
        api.force_authenticate(user)
        self.assertEqual(api.get(self.url).status_code, 200)

    def test_internal_admin_forbidden(self):
        ia = User.objects.create_user(
            username="ia", password="pw", role=User.Role.INTERNAL_ADMIN,
            is_staff=True, is_superuser=True,
        )
        api = APIClient()
        api.force_authenticate(ia)
        self.assertEqual(api.get(self.url).status_code, 403)

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        CategoryResolver(org_b).resolve([{"id": "99", "name": "B-only"}])
        names = [r["name"] for r in self.api.get(self.url).json()]
        self.assertNotIn("B-only", names)
