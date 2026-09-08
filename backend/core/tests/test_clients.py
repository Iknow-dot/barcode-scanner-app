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

    def test_timeout_is_504(self):
        with mock.patch('httpx.post', side_effect=httpx.TimeoutException('slow')):
            response = self._lookup()
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.data['code'], 'RS_GE_TIMEOUT')

    def test_connection_error_is_502(self):
        with mock.patch('httpx.post', side_effect=httpx.ConnectError('refused')):
            response = self._lookup()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.data['code'], 'RS_GE_ERROR')

    def test_upstream_non_200_is_not_found_with_upstream_status(self):
        with mock.patch('httpx.post', return_value=_mock_httpx_response(500)):
            response = self._lookup()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'RS_GE_NOT_FOUND')
        self.assertEqual(response.data['external_service_status_code'], 500)

    def test_unparseable_body_is_502(self):
        with mock.patch('httpx.post', return_value=_mock_httpx_response(200, json_raises=True)):
            response = self._lookup()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.data['code'], 'RS_GE_PARSE_ERROR')


def _upstream(status_code, body=None):
    """A 1C reply as the client transport (httpx.request) returns it."""
    resp = _mock_httpx_response(status_code, body)
    resp.text = ''  # the client logs response.text[:n]; a bare Mock cannot be sliced
    return resp


@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class CreateClientAPIViewTests(TestCase):
    """The wire contract ClientLookupModal.js reads (name / phone / address / raw)."""

    def setUp(self):
        self.org = _make_organization()
        self.org.encrypt_password('svc-pw')
        self.org.save()
        self.user = User.objects.create_user(
            username='cc-user', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('client-create')
        self.payload = {'first_name': 'Giorgi', 'last_name': 'Beridze', 'phone': '+995555'}

    def test_created_client_is_normalized_from_the_wrapped_customer(self):
        body = {'status': 'created', 'customer': {'name': 'Giorgi Beridze', 'address': 'Tbilisi', 'phone': '+995555'}}
        with mock.patch('httpx.request', return_value=_upstream(201, body)):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['name'], 'Giorgi Beridze')
        self.assertEqual(response.data['address'], 'Tbilisi')
        self.assertEqual(response.data['phone'], '+995555')
        self.assertEqual(response.data['raw'], body['customer'])

    def test_unwrappable_body_falls_back_to_raw(self):
        with mock.patch('httpx.request', return_value=_upstream(200, 'ok')):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['raw'], 'ok')
        self.assertFalse(response.data.get('name'))

    def test_upstream_409_is_client_already_exists(self):
        with mock.patch('httpx.request', return_value=_upstream(409, {})):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'CLIENT_ALREADY_EXISTS')

    def test_anonymous_request_is_rejected(self):
        response = APIClient().post(self.url, self.payload, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_upstream_204_is_a_success(self):
        with mock.patch('httpx.request', return_value=_upstream(204, {})):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)


@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class CreateClientPartialSuccessTests(TestCase):
    """CreateClient is a non-idempotent write: when the call fails after 1C has
    committed, the consultant is told the registration failed for a client that
    now exists, and retrying either duplicates them or hits CLIENT_ALREADY_EXISTS.
    Every failing branch is verified against CheckClient before it is reported."""

    def setUp(self):
        self.org = _make_organization()
        self.org.encrypt_password('svc-pw')
        self.org.save()
        self.user = User.objects.create_user(
            username='cc-partial', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('client-create')
        self.payload = {
            'first_name': 'Giorgi', 'last_name': 'Beridze',
            'phone': '+995555', 'identification_number': '01001012345',
        }

    def _upstream_router(self, *, create, check):
        """Route by endpoint: `create` and `check` are each a response or an exception."""
        calls = []

        def _inner(method, url, **kwargs):
            calls.append(url)
            outcome = check if url.endswith('CheckClient') else create
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        return _inner, calls

    def test_recovers_the_client_that_landed_despite_a_timeout(self):
        found = [{'name': 'Giorgi Beridze', 'address': 'Tbilisi', 'phone': '+995555'}]
        router, calls = self._upstream_router(
            create=httpx.ReadTimeout('timed out'), check=_upstream(200, found),
        )
        with mock.patch('httpx.request', side_effect=router):
            response = self.client_api.post(self.url, self.payload, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['name'], 'Giorgi Beridze')
        self.assertTrue(any(url.endswith('CheckClient') for url in calls))

    def test_recovers_after_an_unexpected_upstream_status(self):
        found = [{'name': 'Giorgi Beridze', 'phone': '+995555'}]
        router, _ = self._upstream_router(create=_upstream(500, {}), check=_upstream(200, found))
        with mock.patch('httpx.request', side_effect=router):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['name'], 'Giorgi Beridze')

    def test_original_error_stands_when_the_client_is_confirmed_absent(self):
        """Verification found nothing, so the write did not land and the
        consultant can safely retry — the real error is the useful answer."""
        router, _ = self._upstream_router(
            create=httpx.ReadTimeout('timed out'), check=_upstream(404, {}),
        )
        with mock.patch('httpx.request', side_effect=router):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 504, response.data)
        self.assertEqual(response.data['code'], 'EXTERNAL_SERVICE_TIMEOUT')

    def test_unverified_when_the_payload_carries_no_lookup_key(self):
        router, calls = self._upstream_router(
            create=httpx.ReadTimeout('timed out'), check=_upstream(200, []),
        )
        with mock.patch('httpx.request', side_effect=router):
            response = self.client_api.post(
                self.url, {'first_name': 'Giorgi', 'last_name': 'Beridze'}, format='json',
            )
        self.assertEqual(response.data['code'], 'CLIENT_CREATE_UNVERIFIED')
        self.assertFalse(any(url.endswith('CheckClient') for url in calls))

    def test_unverified_when_the_verification_call_also_fails(self):
        router, _ = self._upstream_router(
            create=httpx.ReadTimeout('timed out'), check=httpx.ConnectError('down'),
        )
        with mock.patch('httpx.request', side_effect=router):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.data['code'], 'CLIENT_CREATE_UNVERIFIED')

    def test_already_exists_is_reported_as_is_without_a_verification_call(self):
        router, calls = self._upstream_router(create=_upstream(409, {}), check=_upstream(200, []))
        with mock.patch('httpx.request', side_effect=router):
            response = self.client_api.post(self.url, self.payload, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'CLIENT_ALREADY_EXISTS')
        self.assertEqual(len(calls), 1)


@override_settings(SECURE_SSL_REDIRECT=False, FERNET_KEY=_TEST_FERNET_KEY)
class CheckClientAPIViewTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.org.encrypt_password('svc-pw')
        self.org.save()
        self.user = User.objects.create_user(
            username='ck-user', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.user)
        self.url = reverse('client-check')

    def test_hit_returns_normalized_clients(self):
        body = [{'name': 'Giorgi Beridze', 'address': 'Tbilisi', 'phone': '+995555'}]
        with mock.patch('httpx.request', return_value=_upstream(200, body)):
            response = self.client_api.post(self.url, {'phone': '+995555'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['clients']), 1)
        self.assertEqual(response.data['clients'][0]['name'], 'Giorgi Beridze')
        self.assertEqual(response.data['clients'][0]['raw'], body[0])

    def test_upstream_404_is_client_not_found(self):
        with mock.patch('httpx.request', return_value=_upstream(404, {})):
            response = self.client_api.post(self.url, {'phone': '+995555'}, format='json')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'CLIENT_NOT_FOUND')

    def test_name_only_lookup_reaches_upstream(self):
        captured = {}

        def fake_request(method, url, **kwargs):
            captured['json'] = kwargs.get('json')
            return _upstream(200, [{'name': 'Giorgi Beridze', 'phone': '+995555'}])

        with mock.patch('httpx.request', side_effect=fake_request):
            response = self.client_api.post(
                self.url, {'name': 'Giorgi Beridze'}, format='json',
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(captured['json'], {'IDPhone': 'Giorgi Beridze'})
        self.assertEqual(response.data['clients'][0]['name'], 'Giorgi Beridze')

    def test_name_lookup_returns_every_match(self):
        body = [
            {'name': 'Giorgi Beridze', 'phone': '+995555000111'},
            {'name': 'Giorgi Beridzishvili', 'phone': '+995555000222'},
        ]
        with mock.patch('httpx.request', return_value=_upstream(200, body)):
            response = self.client_api.post(self.url, {'name': 'Giorgi'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['clients']), 2)

    def test_blank_payload_is_still_rejected(self):
        with mock.patch('httpx.request') as upstream:
            response = self.client_api.post(
                self.url, {'identification_number': '', 'phone': '', 'name': ''},
                format='json',
            )
        self.assertEqual(response.status_code, 400)
        upstream.assert_not_called()
