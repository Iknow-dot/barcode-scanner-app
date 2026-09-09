"""PII must never reach the log stream.

Two layers are tested here: the masking helpers in `core.log_redaction`, and
the call sites that use them. The call-site tests assert on the *absence* of
the raw secret in captured output rather than on an exact message, so they
keep holding when a message is reworded.
"""
from __future__ import annotations

import logging
from unittest import mock

import httpx
from django.test import TestCase, override_settings

from core.log_redaction import describe_shape, mask_coords, mask_id, mask_phone, mask_text, safe_body
from core.services.consult_web_exchange import ConsultWebExchangeClient, ConsultWebExchangeError
from core.services.photon import PhotonError, reverse_geocode, search_addresses
from core.services.rs_ge import RSGeError, lookup_taxpayer
from core.tests.common import _TEST_FERNET_KEY, _make_organization


# A realistic Georgian personal number, phone and address. Every test below
# asserts these strings never appear in captured log output.
REAL_ID = '01008012345'
REAL_PHONE = '995555123456'
REAL_ADDRESS = 'Rustaveli Avenue 12, Tbilisi'
REAL_NAME = 'Nino Beridze'


def _response(status_code: int, body=None, text: str = ''):
    resp = mock.Mock(spec=httpx.Response)
    resp.status_code = status_code
    if body is None:
        resp.json.side_effect = ValueError('not json')
    else:
        resp.json.return_value = body
    resp.text = text
    return resp


class MaskIdTests(TestCase):
    def test_keeps_first_and_last_two_characters(self):
        self.assertEqual(mask_id(REAL_ID), '01*******45')

    def test_masks_short_values_entirely(self):
        self.assertEqual(mask_id('12345'), '*****')

    def test_blank_and_none_stay_empty(self):
        self.assertEqual(mask_id(''), '')
        self.assertEqual(mask_id(None), '')


class MaskPhoneTests(TestCase):
    def test_keeps_only_the_last_two_digits(self):
        self.assertEqual(mask_phone(REAL_PHONE), '**********56')

    def test_masks_short_values_entirely(self):
        self.assertEqual(mask_phone('12'), '**')

    def test_blank_stays_empty(self):
        self.assertEqual(mask_phone(None), '')


class MaskTextTests(TestCase):
    def test_keeps_a_short_prefix_and_the_length(self):
        self.assertEqual(mask_text(REAL_ADDRESS), 'Rus...(28 chars)')

    def test_value_shorter_than_the_prefix_shows_length_only(self):
        self.assertEqual(mask_text('ab'), '...(2 chars)')

    def test_blank_stays_empty(self):
        self.assertEqual(mask_text(''), '')

    def test_output_is_ascii(self):
        mask_text(REAL_ADDRESS).encode('ascii')


class MaskCoordsTests(TestCase):
    def test_rounds_to_one_decimal(self):
        self.assertEqual(mask_coords(41.71512, 44.82709), '41.7,44.8')

    def test_non_numeric_input_does_not_raise(self):
        self.assertEqual(mask_coords('abc', None), '?,?')


class SafeBodyTests(TestCase):
    def test_redacts_sensitive_keys_and_keeps_diagnostics(self):
        rendered = safe_body(_response(400, {
            'success': False,
            'message': 'validation failed',
            'name': REAL_NAME,
            'personal_number': REAL_ID,
            'phone_1': REAL_PHONE,
            'address_line': REAL_ADDRESS,
        }))
        self.assertNotIn(REAL_NAME, rendered)
        self.assertNotIn(REAL_ID, rendered)
        self.assertNotIn(REAL_PHONE, rendered)
        self.assertNotIn(REAL_ADDRESS, rendered)
        self.assertIn('validation failed', rendered)
        self.assertIn('success', rendered)

    def test_matches_sensitive_keys_regardless_of_case(self):
        rendered = safe_body(_response(400, {'IDPhone': REAL_ID, 'Email': 'a@b.com'}))
        self.assertNotIn(REAL_ID, rendered)
        self.assertNotIn('a@b.com', rendered)

    def test_redacts_inside_nested_lists_and_dicts(self):
        rendered = safe_body(_response(200, {
            'customers': [{'name': REAL_NAME, 'contacts': {'phone': REAL_PHONE}}],
        }))
        self.assertNotIn(REAL_NAME, rendered)
        self.assertNotIn(REAL_PHONE, rendered)

    def test_non_json_body_is_summarized_not_echoed(self):
        rendered = safe_body(_response(500, None, text=f'client {REAL_NAME} exploded'))
        self.assertNotIn(REAL_NAME, rendered)
        self.assertIn('non-json', rendered)

    def test_truncates_to_the_limit(self):
        rendered = safe_body(_response(200, {'items': ['x' * 50] * 40}), limit=120)
        self.assertLessEqual(len(rendered), 120)

    def test_truncation_marker_is_ascii(self):
        # A non-ASCII marker makes StreamHandler.emit raise on a cp1252
        # console, which loses the whole log line.
        rendered = safe_body(_response(200, {'items': ['x' * 50] * 40}), limit=120)
        rendered.encode('ascii')

    def test_accepts_a_plain_mapping(self):
        rendered = safe_body({'name': REAL_NAME, 'OrderNumber': ''})
        self.assertNotIn(REAL_NAME, rendered)
        self.assertIn('OrderNumber', rendered)


class DescribeShapeTests(TestCase):
    """Keys without values — the safe way to learn an under-documented API's
    response shape, including fields we have no mapping (and so no redaction
    rule) for yet."""

    def test_reports_entry_count_and_keys_but_no_values(self):
        shape = describe_shape([{'name': REAL_NAME, 'phone': REAL_PHONE}])
        self.assertNotIn(REAL_NAME, shape)
        self.assertNotIn(REAL_PHONE, shape)
        self.assertIn('name', shape)
        self.assertIn('phone', shape)
        self.assertIn('1', shape)

    def test_reports_keys_of_an_unmapped_field(self):
        shape = describe_shape([{'passport_scan': 'MC1234567'}])
        self.assertIn('passport_scan', shape)
        self.assertNotIn('MC1234567', shape)

    def test_describes_a_mapping_without_its_values(self):
        shape = describe_shape({'status': 'zzz-marker'})
        self.assertIn('status', shape)
        self.assertNotIn('zzz-marker', shape)

    def test_empty_body_is_reported_as_empty(self):
        self.assertEqual(describe_shape(None), 'empty')


@override_settings(FERNET_KEY=_TEST_FERNET_KEY)
class ConsultWebExchangeLogRedactionTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.client_1c = ConsultWebExchangeClient(self.org)

    def test_successful_client_lookup_does_not_log_the_client_record(self):
        body = [{'name': REAL_NAME, 'phone': REAL_PHONE, 'address': REAL_ADDRESS}]
        response = _response(200, body, text=str(body))
        with mock.patch('httpx.request', return_value=response):
            with self.assertLogs('core.services.consult_web_exchange', level='INFO') as logs:
                self.client_1c.check_client(identification_number=REAL_ID)
        output = '\n'.join(logs.output)
        self.assertNotIn(REAL_NAME, output)
        self.assertNotIn(REAL_PHONE, output)
        self.assertNotIn(REAL_ADDRESS, output)

    def test_failed_client_lookup_does_not_log_the_response_body(self):
        response = _response(500, {'name': REAL_NAME}, text=str({'name': REAL_NAME}))
        with mock.patch('httpx.request', return_value=response):
            with self.assertLogs('core.services.consult_web_exchange', level='WARNING') as logs:
                with self.assertRaises(ConsultWebExchangeError):
                    self.client_1c.check_client(identification_number=REAL_ID)
        self.assertNotIn(REAL_NAME, '\n'.join(logs.output))

    def test_failed_client_create_does_not_log_the_echoed_payload(self):
        echoed = {'success': False, 'message': 'bad', 'personal_number': REAL_ID, 'name': REAL_NAME}
        response = _response(422, echoed, text=str(echoed))
        with mock.patch('httpx.request', return_value=response):
            with self.assertLogs('core.services.consult_web_exchange', level='WARNING') as logs:
                with self.assertRaises(ConsultWebExchangeError):
                    self.client_1c.create_client({
                        'first_name': 'Nino', 'last_name': 'Beridze',
                        'identification_number': REAL_ID, 'phone': REAL_PHONE,
                    })
        output = '\n'.join(logs.output)
        self.assertNotIn(REAL_ID, output)
        self.assertNotIn(REAL_NAME, output)

    def test_rejected_order_does_not_log_the_client_identifier(self):
        rejected = {'success': False, 'message': 'no such client', 'ClientIDPhone': REAL_ID}
        response = _response(400, rejected, text=str(rejected))
        with mock.patch('httpx.request', return_value=response):
            with self.assertLogs('core.services.consult_web_exchange', level='WARNING') as logs:
                with self.assertRaises(ConsultWebExchangeError):
                    self.client_1c.create_order(
                        client_id_phone=REAL_ID, user_id='u', stock_id='w',
                        items=[{'sku': 'A1', 'quantity': 1, 'price': 1, 'cost': 1}],
                    )
        self.assertNotIn(REAL_ID, '\n'.join(logs.output))


class RSGeLogRedactionTests(TestCase):
    def test_timeout_does_not_log_the_identification_number(self):
        with mock.patch('httpx.post', side_effect=httpx.TimeoutException('slow')):
            with self.assertLogs('core.services.rs_ge', level='ERROR') as logs:
                with self.assertRaises(RSGeError):
                    lookup_taxpayer(REAL_ID)
        self.assertNotIn(REAL_ID, '\n'.join(logs.output))

    def test_transport_error_does_not_log_the_identification_number(self):
        with mock.patch('httpx.post', side_effect=httpx.ConnectError('refused')):
            with self.assertLogs('core.services.rs_ge', level='ERROR') as logs:
                with self.assertRaises(RSGeError):
                    lookup_taxpayer(REAL_ID)
        self.assertNotIn(REAL_ID, '\n'.join(logs.output))

    def test_non_200_does_not_log_the_identification_number(self):
        with mock.patch('httpx.post', return_value=_response(503, {})):
            with self.assertLogs('core.services.rs_ge', level='WARNING') as logs:
                with self.assertRaises(RSGeError):
                    lookup_taxpayer(REAL_ID)
        self.assertNotIn(REAL_ID, '\n'.join(logs.output))


class PhotonLogRedactionTests(TestCase):
    def test_search_failure_does_not_log_the_typed_address(self):
        with mock.patch('httpx.get', side_effect=httpx.TimeoutException('slow')):
            with self.assertLogs('core.services.photon', level='ERROR') as logs:
                with self.assertRaises(PhotonError):
                    search_addresses(REAL_ADDRESS)
        self.assertNotIn(REAL_ADDRESS, '\n'.join(logs.output))

    def test_search_non_200_does_not_log_the_typed_address(self):
        with mock.patch('httpx.get', return_value=_response(429, {})):
            with self.assertLogs('core.services.photon', level='WARNING') as logs:
                with self.assertRaises(PhotonError):
                    search_addresses(REAL_ADDRESS)
        self.assertNotIn(REAL_ADDRESS, '\n'.join(logs.output))

    def test_reverse_failure_does_not_log_precise_coordinates(self):
        with mock.patch('httpx.get', side_effect=httpx.TimeoutException('slow')):
            with self.assertLogs('core.services.photon', level='ERROR') as logs:
                with self.assertRaises(PhotonError):
                    reverse_geocode(41.71512, 44.82709)
        output = '\n'.join(logs.output)
        self.assertNotIn('41.71512', output)
        self.assertNotIn('44.82709', output)


class HttpxLoggerTests(TestCase):
    """httpx logs 'HTTP Request: GET <full url>' at INFO. The Photon URL carries
    the typed address in `q=`, so the library logger must stay above INFO."""

    def test_httpx_logger_is_pinned_above_info(self):
        self.assertFalse(logging.getLogger('httpx').isEnabledFor(logging.INFO))

    def test_httpcore_logger_is_pinned_above_info(self):
        self.assertFalse(logging.getLogger('httpcore').isEnabledFor(logging.INFO))
