from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import Organization, Product, ProductBarcode, Warehouse
from core.tests.common import _TEST_FERNET_KEY, _make_organization
from users.models import AllowedIP, User


@override_settings(FERNET_KEY=_TEST_FERNET_KEY)
class SeedLoadtestTests(TestCase):
    def _seed(self, **kwargs):
        options = dict(orgs=1, users_per_org=3, warehouses_per_org=2,
                       products=5, orders=0, verbosity=0, stdout=StringIO())
        options.update(kwargs)
        call_command("seed_loadtest", **options)

    def test_seeds_orgs_users_warehouses_and_products(self):
        self._seed()

        org = Organization.objects.get(name="loadtest-org-1")
        self.assertTrue(org.product_catalog_enabled)
        self.assertEqual(org.decrypt_password(), "loadtest-1c-password")
        self.assertEqual(Warehouse.objects.filter(organization=org).count(), 2)
        self.assertEqual(Product.objects.filter(organization=org).count(), 5)
        self.assertEqual(ProductBarcode.objects.filter(product__organization=org).count(), 5)

    def test_seeded_users_can_actually_log_in(self):
        """Device lock and IP allowlists silently 403 every VU but the first."""
        self._seed()

        users = User.objects.filter(username__startswith="loadtest-user-")
        self.assertEqual(users.count(), 3)
        for user in users:
            self.assertFalse(user.device_lock_enabled)
            self.assertEqual(user.bound_device_id, "")
            self.assertTrue(user.check_password("loadtest-pass-1234"))
            self.assertEqual(user.role, User.Role.COMPANY_USER)
            self.assertTrue(user.warehouses.exists())
        self.assertFalse(AllowedIP.objects.filter(user__in=users).exists())

    def test_reseeding_repairs_tampered_device_lock_and_ip_allowlist(self):
        """The three device-lock/IP-allowlist assertions above pass vacuously on a
        fresh database, since they match the User model's own defaults. This test
        proves the command actively repairs them: it seeds once, deliberately
        breaks device_lock_enabled, bound_device_id and AllowedIP for the seeded
        users the way an admin action or a stale prior run might, reseeds with the
        same arguments, and asserts every seeded user is back to VU-safe.
        """
        self._seed()

        users = User.objects.filter(username__startswith="loadtest-user-")
        self.assertEqual(users.count(), 3)
        users.update(device_lock_enabled=True, bound_device_id="stale-device")
        AllowedIP.objects.create(user=users.first(), ip_or_network="10.0.0.1")

        self._seed()

        users = User.objects.filter(username__startswith="loadtest-user-")
        self.assertEqual(users.count(), 3)
        for user in users:
            self.assertFalse(user.device_lock_enabled)
            self.assertEqual(user.bound_device_id, "")
        self.assertFalse(AllowedIP.objects.filter(user__in=users).exists())

    def test_employees_count_covers_the_seeded_users(self):
        self._seed(users_per_org=3)
        self.assertGreaterEqual(Organization.objects.get(name="loadtest-org-1").employees_count, 3)

    def test_seeding_twice_is_idempotent(self):
        self._seed()
        self._seed()

        self.assertEqual(Organization.objects.filter(name__startswith="loadtest-org-").count(), 1)
        self.assertEqual(User.objects.filter(username__startswith="loadtest-user-").count(), 3)
        self.assertEqual(Product.objects.filter(sku__startswith="LT-SKU-").count(), 5)

    def test_reset_removes_only_the_seeded_orgs(self):
        keeper = _make_organization(name="RealOrg", identification_number="55555")
        keeper_user = User.objects.create_user(
            username="real-user", password="x", role=User.Role.COMPANY_USER, organization=keeper,
        )
        self._seed()

        self._seed(reset=True, orgs=0, users_per_org=0, products=0)

        self.assertFalse(Organization.objects.filter(name__startswith="loadtest-org-").exists())
        self.assertFalse(User.objects.filter(username__startswith="loadtest-user-").exists())
        self.assertTrue(Organization.objects.filter(pk=keeper.pk).exists())
        self.assertTrue(User.objects.filter(pk=keeper_user.pk).exists())

    def test_products_carry_a_category_tree_and_image_urls(self):
        self._seed(products=5)

        product = Product.objects.filter(sku="LT-SKU-1").select_related("category").first()
        self.assertIsNotNone(product.category)
        self.assertEqual(len(product.category.path_names), 3)
        self.assertTrue(product.image_urls)
        self.assertIn("color", product.attributes)

    def test_orders_are_seeded_with_items(self):
        self._seed(orders=4)

        from core.models import PurchaseOrder
        orders = PurchaseOrder.objects.filter(organization__name="loadtest-org-1")
        self.assertEqual(orders.count(), 4)
        self.assertTrue(all(o.items.exists() for o in orders))
