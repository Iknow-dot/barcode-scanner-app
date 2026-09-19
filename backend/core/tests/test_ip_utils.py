"""Client-address extraction: each deployment trusts exactly one source.

Everything left of the entries our own proxies appended to X-Forwarded-For is
whatever the client sent, so trusting the first entry lets anyone pass an IP
allowlist by naming an allowed address.
"""
from django.test import RequestFactory, SimpleTestCase, override_settings

from core.ip_utils import get_client_ip


def _request(**meta):
    return RequestFactory().get('/', **meta)


class DefaultSourceTests(SimpleTestCase):
    def test_uses_the_connecting_address(self):
        self.assertEqual(get_client_ip(_request(REMOTE_ADDR='10.0.0.1')), '10.0.0.1')

    def test_ignores_forwarded_for(self):
        request = _request(HTTP_X_FORWARDED_FOR='203.0.113.9', REMOTE_ADDR='10.0.0.1')
        self.assertEqual(get_client_ip(request), '10.0.0.1')

    def test_request_without_meta_is_unknown(self):
        self.assertIsNone(get_client_ip(object()))


class TrustedProxyCountTests(SimpleTestCase):
    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_one_proxy_takes_the_entry_it_appended(self):
        request = _request(
            HTTP_X_FORWARDED_FOR='198.51.100.66, 203.0.113.9', REMOTE_ADDR='10.0.0.1',
        )
        self.assertEqual(get_client_ip(request), '203.0.113.9')

    @override_settings(TRUSTED_PROXY_COUNT=2)
    def test_two_proxies_take_the_second_entry_from_the_right(self):
        request = _request(
            HTTP_X_FORWARDED_FOR='198.51.100.66, 203.0.113.9, 10.0.0.2', REMOTE_ADDR='10.0.0.1',
        )
        self.assertEqual(get_client_ip(request), '203.0.113.9')

    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_tolerates_whitespace_around_entries(self):
        request = _request(HTTP_X_FORWARDED_FOR=' 203.0.113.9 ', REMOTE_ADDR='10.0.0.1')
        self.assertEqual(get_client_ip(request), '203.0.113.9')

    @override_settings(TRUSTED_PROXY_COUNT=2)
    def test_fewer_entries_than_proxies_is_unknown(self):
        # A proxy that should have appended didn't, so no entry is known to be
        # ours; fall back to nothing rather than to a client-written value.
        request = _request(HTTP_X_FORWARDED_FOR='203.0.113.9', REMOTE_ADDR='10.0.0.1')
        self.assertIsNone(get_client_ip(request))

    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_missing_forwarded_for_is_unknown(self):
        self.assertIsNone(get_client_ip(_request(REMOTE_ADDR='10.0.0.1')))


@override_settings(CLIENT_IP_HEADER='DO-Connecting-IP')
class TrustedHeaderTests(SimpleTestCase):
    def test_header_wins_over_forwarded_for_and_connecting_address(self):
        request = _request(
            HTTP_DO_CONNECTING_IP='203.0.113.9',
            HTTP_X_FORWARDED_FOR='198.51.100.66', REMOTE_ADDR='10.0.0.1',
        )
        self.assertEqual(get_client_ip(request), '203.0.113.9')

    def test_missing_header_is_unknown(self):
        # Without the header the request did not come through the edge proxy
        # that sets it, and REMOTE_ADDR is an internal address.
        request = _request(HTTP_X_FORWARDED_FOR='203.0.113.9', REMOTE_ADDR='10.0.0.1')
        self.assertIsNone(get_client_ip(request))
