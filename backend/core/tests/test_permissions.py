from __future__ import annotations

from django.test import TestCase
from users.models import User
from core.tests.common import _make_organization


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
