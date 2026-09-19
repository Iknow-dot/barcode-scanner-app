from core.models import Organization
from django.contrib import admin
from django.forms.models import model_to_dict
from django.test import RequestFactory, TestCase, override_settings
from users.admin import UserAdmin
from rest_framework.test import APIClient
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken
from users.models import AllowedIP, User

LOGIN_URL = '/api/v1/users/auth/login/'
REFRESH_URL = '/api/v1/users/auth/refresh/'
PROTECTED_URL = '/api/v1/users/ip/'  # any JWT-protected GET


@override_settings(SECURE_SSL_REDIRECT=False)
class SessionRevocationTests(TestCase):
    """Changing what a session was granted on ends the session: a password
    change at once, an IP allowlist or device change at the next refresh
    (so within one 15-minute access token)."""

    def setUp(self):
        org = Organization.objects.create(
            name='RevokeOrg', identification_number='900800791',
            web_service_url='http://example.com/db', employees_count=5,
        )
        self.user = User.objects.create_user(
            username='consultant', password='Old-Strong-Pass-1',
            role=User.Role.COMPANY_USER, organization=org, device_lock_enabled=False,
        )
        self.admin = User.objects.create_user(
            username='org-admin', password='Adm1n-Strong-Pass',
            role=User.Role.COMPANY_ADMIN, organization=org,
        )

    def _login(self, ip='198.51.100.7'):
        response = APIClient().post(
            LOGIN_URL, {'username': 'consultant', 'password': 'Old-Strong-Pass-1'},
            format='json', REMOTE_ADDR=ip,
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def _get(self, access):
        return APIClient().get(PROTECTED_URL, HTTP_AUTHORIZATION=f'Bearer {access}')

    def _refresh(self, refresh, ip='198.51.100.7'):
        return APIClient().post(
            REFRESH_URL, {'refresh': refresh}, format='json', REMOTE_ADDR=ip,
        )

    def _change_password(self):
        self.user.set_password('New-Strong-Pass-2')
        self.user.save()

    def test_unchanged_session_keeps_working(self):
        tokens = self._login()
        response = self._refresh(tokens['refresh_token'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._get(response.data['access']).status_code, 200)

    def test_password_change_ends_the_access_token(self):
        tokens = self._login()
        self.assertEqual(self._get(tokens['access_token']).status_code, 200)
        self._change_password()
        self.assertEqual(self._get(tokens['access_token']).status_code, 401)

    def test_password_change_ends_the_refresh_token(self):
        tokens = self._login()
        self._change_password()
        self.assertEqual(self._refresh(tokens['refresh_token']).status_code, 401)

    def test_tokens_without_the_password_claim_are_refused(self):
        # Every session in flight looks like this on the deploy that turns the
        # check on, so everyone logs in again once.
        refresh = RefreshToken.for_user(self.user)
        del refresh[api_settings.REVOKE_TOKEN_CLAIM]
        self.assertEqual(self._get(str(refresh.access_token)).status_code, 401)
        self.assertEqual(self._refresh(str(refresh)).status_code, 401)

    def test_refresh_from_outside_the_allowlist_is_refused_without_spending_the_token(self):
        AllowedIP.objects.create(user=self.user, ip_or_network='198.51.100.7')
        tokens = self._login(ip='198.51.100.7')
        refused = self._refresh(tokens['refresh_token'], ip='203.0.113.50')
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data['code'], 'IP_NOT_ALLOWED')
        # Checked before rotation: back on the allowed network it still works.
        self.assertEqual(self._refresh(tokens['refresh_token']).status_code, 200)

    def test_allowlist_added_after_login_applies_at_refresh(self):
        tokens = self._login(ip='203.0.113.50')
        AllowedIP.objects.create(user=self.user, ip_or_network='198.51.100.7')
        refused = self._refresh(tokens['refresh_token'], ip='203.0.113.50')
        self.assertEqual(refused.status_code, 403)

    def _save_in_admin(self, **changes):
        # The admin's own save path: its form and UserAdmin.save_model.
        request = RequestFactory().post('/admin/')
        request.user = self.admin
        model_admin = UserAdmin(User, admin.site)
        data = model_to_dict(self.user)
        data.update(changes)
        form = model_admin.form(data=data, instance=self.user)
        self.assertTrue(form.is_valid(), form.errors)
        model_admin.save_model(request, form.save(commit=False), form, change=True)

    def test_clearing_the_device_in_django_admin_ends_existing_sessions(self):
        # The admin's Device lock section tells admins to clear bound_device_id;
        # that must end the old device's sessions like the API reset does.
        self.user.device_lock_enabled = True
        self.user.save()
        tokens = self._login()
        self.user.refresh_from_db()
        self._save_in_admin(bound_device_id='')
        self.assertEqual(self._refresh(tokens['refresh_token']).status_code, 401)

    def test_refresh_for_a_deleted_user_is_401_not_500(self):
        # simplejwt 5.5.1 looks the user up with .get() and let DoesNotExist
        # escape as a server error.
        tokens = self._login()
        self.user.delete()
        response = self._refresh(tokens['refresh_token'])
        self.assertEqual(response.status_code, 401)

    def test_other_admin_edits_keep_sessions(self):
        tokens = self._login()
        self.user.refresh_from_db()
        self._save_in_admin(first_name='Renamed')
        self.assertEqual(self._refresh(tokens['refresh_token']).status_code, 200)

    def test_device_reset_ends_existing_sessions(self):
        self.user.device_lock_enabled = True
        self.user.save()
        tokens = self._login()
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        reset = admin_client.post(f'/api/v1/users/{self.user.id}/reset-device/')
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(self._refresh(tokens['refresh_token']).status_code, 401)
