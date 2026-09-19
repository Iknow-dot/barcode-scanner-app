from unittest import mock

from core.models import Organization
from django.test import Client, TestCase, override_settings
from rest_framework.test import APIClient
from users import login_throttle
from users.models import User

LOGIN_URL = '/api/v1/users/auth/login/'


class _LoginThrottleCase(TestCase):
    def setUp(self):
        org = Organization.objects.create(
            name='ThrottleOrg', identification_number='900800790',
            web_service_url='http://example.com/db', employees_count=50,
        )
        self.user = User.objects.create_user(
            username='consultant', password='right-pass-1',
            role=User.Role.COMPANY_USER, organization=org, device_lock_enabled=False,
        )

    def _login(self, password, username='consultant', ip='198.51.100.7'):
        return APIClient().post(
            LOGIN_URL, {'username': username, 'password': password},
            format='json', REMOTE_ADDR=ip,
        )

    def _fail(self, times, **kwargs):
        for _ in range(times):
            self.assertEqual(self._login('wrong', **kwargs).status_code, 401)


@override_settings(SECURE_SSL_REDIRECT=False)
class LoginFailureLockoutTests(_LoginThrottleCase):
    def test_locked_out_after_repeated_failures_even_with_the_right_password(self):
        self._fail(login_throttle.PAIR_LIMIT)
        response = self._login('right-pass-1')
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data['code'], 'LOGIN_THROTTLED')
        self.assertGreater(response.data['retry_after'], 0)
        self.assertEqual(response['Retry-After'], str(response.data['retry_after']))

    def test_lockout_hides_whether_the_password_was_right(self):
        # IP_NOT_ALLOWED is only raised after a correct password, so a blocked
        # guesser must get the same answer for right and wrong passwords.
        self._fail(login_throttle.PAIR_LIMIT)
        self.assertEqual(self._login('wrong').data['code'], 'LOGIN_THROTTLED')
        self.assertEqual(self._login('right-pass-1').data['code'], 'LOGIN_THROTTLED')

    def test_failures_below_the_limit_do_not_block(self):
        self._fail(login_throttle.PAIR_LIMIT - 1)
        self.assertEqual(self._login('right-pass-1').status_code, 200)

    def test_failures_elsewhere_do_not_lock_the_user_out_of_their_shop(self):
        self._fail(login_throttle.PAIR_LIMIT, ip='203.0.113.50')
        self.assertEqual(self._login('right-pass-1', ip='198.51.100.7').status_code, 200)

    def test_success_clears_the_users_failures(self):
        self._fail(login_throttle.PAIR_LIMIT - 1)
        self.assertEqual(self._login('right-pass-1').status_code, 200)
        self._fail(login_throttle.PAIR_LIMIT - 1)
        self.assertEqual(self._login('right-pass-1').status_code, 200)

    def test_one_address_spraying_many_usernames_is_locked_out(self):
        for i in range(login_throttle.IP_LIMIT):
            self._login('wrong', username=f'guess-{i}')
        self.assertEqual(self._login('right-pass-1').status_code, 429)
        self.assertEqual(
            self._login('right-pass-1', ip='203.0.113.50').status_code, 200,
        )

    def test_lockout_ends_with_the_window(self):
        with mock.patch.object(login_throttle, '_now', return_value=1_000_000.0):
            self._fail(login_throttle.PAIR_LIMIT)
            self.assertEqual(self._login('right-pass-1').status_code, 429)
        later = 1_000_000.0 + login_throttle.WINDOW_SECONDS
        with mock.patch.object(login_throttle, '_now', return_value=later):
            self.assertEqual(self._login('right-pass-1').status_code, 200)

    def test_cache_outage_lets_logins_through(self):
        # A missing cache table must not stop a whole sales floor logging in.
        broken = mock.Mock(**{'get.side_effect': RuntimeError('no table'),
                              'set.side_effect': RuntimeError('no table'),
                              'delete.side_effect': RuntimeError('no table')})
        with mock.patch.object(login_throttle, '_cache', return_value=broken), \
                self.assertLogs('users.login_throttle', level='ERROR'):
            self._fail(login_throttle.PAIR_LIMIT)
            self.assertEqual(self._login('right-pass-1').status_code, 200)


@override_settings(SECURE_SSL_REDIRECT=False)
class AdminLoginLockoutTests(_LoginThrottleCase):
    def setUp(self):
        super().setUp()
        User.objects.create_user(
            username='root', password='right-pass-1',
            role=User.Role.INTERNAL_ADMIN, is_staff=True, is_superuser=True,
        )

    def _admin_login(self, password):
        client = Client(REMOTE_ADDR='198.51.100.7')
        client.post('/admin/login/', {'username': 'root', 'password': password})
        return client

    def test_admin_login_is_locked_out_too(self):
        for _ in range(login_throttle.PAIR_LIMIT):
            self.assertNotIn('_auth_user_id', self._admin_login('wrong').session)
        self.assertNotIn('_auth_user_id', self._admin_login('right-pass-1').session)

    def test_admin_login_works_below_the_limit(self):
        self._admin_login('wrong')
        self.assertIn('_auth_user_id', self._admin_login('right-pass-1').session)
