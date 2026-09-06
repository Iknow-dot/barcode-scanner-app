from __future__ import annotations

import httpx
import os

from core.services.photon import PhotonError, reverse_geocode, search_addresses
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from unittest import mock
from users.models import User
from core.tests.common import _TEST_FERNET_KEY, _make_organization, _mock_httpx_response, _photon_collection, _photon_feature, _rs_ge_record


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


@override_settings(SECURE_SSL_REDIRECT=False)
class RSGeLookupAPIViewTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.url = reverse('rs-ge-lookup')

    def _lookup(self, identification_number='01001000001'):
        return self.client_api.post(
            self.url,
            {'identification_number': identification_number},
            format='json',
        )

    def test_happy_path_splits_full_name(self):
        body = _rs_ge_record(
            Status='არამეწარმე ფ/პ',
            RegisteredSubject='ფიზიკური პირი',
            FullName='გიორგი ბერიძე',
        )
        with mock.patch('httpx.post', return_value=_mock_httpx_response(200, body)):
            response = self._lookup()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['first_name'], 'გიორგი')
        self.assertEqual(response.data['last_name'], 'ბერიძე')

    def test_null_full_name_returns_not_found(self):
        # RS.ge signals "unknown ID" with a 200 and an all-null record
        with mock.patch('httpx.post', return_value=_mock_httpx_response(200, _rs_ge_record())):
            response = self._lookup()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'RS_GE_NOT_FOUND')

    def test_missing_full_name_key_returns_not_found(self):
        body = [{'Status': 'x', 'NonResident': 'არა'}]
        with mock.patch('httpx.post', return_value=_mock_httpx_response(200, body)):
            response = self._lookup()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'RS_GE_NOT_FOUND')

    def test_blank_full_name_returns_not_found(self):
        with mock.patch(
            'httpx.post',
            return_value=_mock_httpx_response(200, _rs_ge_record(FullName='   ')),
        ):
            response = self._lookup()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'RS_GE_NOT_FOUND')

    def test_single_token_full_name_returns_empty_last_name(self):
        body = _rs_ge_record(
            Status='აქტიური',
            RegisteredSubject='იურიდიული პირი',
            FullName='ალფა',
        )
        with mock.patch('httpx.post', return_value=_mock_httpx_response(200, body)):
            response = self._lookup()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['first_name'], 'ალფა')
        self.assertEqual(response.data['last_name'], '')
