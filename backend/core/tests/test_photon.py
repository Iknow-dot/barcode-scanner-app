from __future__ import annotations

from unittest import mock

import httpx
from django.test import TestCase, override_settings

from core.services.photon import PhotonError, reverse_geocode, search_addresses
from core.tests.common import _mock_httpx_response, _photon_collection, _photon_feature


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

        with override_settings(PHOTON_USER_AGENT='TestAgent/9.9'):
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
