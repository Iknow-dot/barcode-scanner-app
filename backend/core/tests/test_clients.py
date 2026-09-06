from __future__ import annotations

import httpx

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from unittest import mock
from users.models import User
from core.tests.common import _TEST_FERNET_KEY, _make_organization, _mock_httpx_response, _photon_collection, _photon_feature, _rs_ge_record


@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class ReverseGeocodeAPIViewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='u', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('client-reverse-geocode')

    def tearDown(self):
        cache.clear()

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


@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class SearchAddressesAPIViewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='u', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('client-search-addresses')

    def tearDown(self):
        cache.clear()

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
