from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import Organization, Product, ProductBarcode, PurchaseOrder, Warehouse
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
        users (company users and the per-org company_admin alike) the way an admin
        action or a stale prior run might, reseeds with the same arguments, and
        asserts every seeded user is back to VU-safe.
        """
        self._seed()

        users = list(User.objects.filter(username__startswith="loadtest-user-")) + [
            User.objects.get(username="loadtest-admin-1"),
        ]
        self.assertEqual(len(users), 4)
        pks = [u.pk for u in users]
        User.objects.filter(pk__in=pks).update(
            device_lock_enabled=True, bound_device_id="stale-device",
        )
        AllowedIP.objects.create(user=users[0], ip_or_network="10.0.0.1")
        AllowedIP.objects.create(user=users[-1], ip_or_network="10.0.0.2")

        self._seed()

        users = User.objects.filter(pk__in=pks)
        self.assertEqual(users.count(), 4)
        for user in users:
            self.assertFalse(user.device_lock_enabled)
            self.assertEqual(user.bound_device_id, "")
        self.assertFalse(AllowedIP.objects.filter(user__in=users).exists())

    def test_seeds_a_company_admin_per_org(self):
        """catalog/sync-status/ and analytics/orders/ are IsCompanyAdmin-gated and
        403 every company_user — a k6 scenario against those needs a real admin
        account with the same VU-safety guarantees as the company users."""
        self._seed()

        admin = User.objects.get(username="loadtest-admin-1")
        self.assertEqual(admin.role, User.Role.COMPANY_ADMIN)
        self.assertEqual(admin.organization, Organization.objects.get(name="loadtest-org-1"))
        self.assertFalse(admin.device_lock_enabled)
        self.assertEqual(admin.bound_device_id, "")
        self.assertFalse(AllowedIP.objects.filter(user=admin).exists())
        self.assertTrue(admin.warehouses.exists())
        self.assertTrue(admin.check_password("loadtest-pass-1234"))

    def test_company_admin_does_not_shift_company_user_numbering(self):
        """loadtest-admin-<org index> must not consume a slot in the globally
        sequential loadtest-user-<n> numbering that existing k6 config assumes."""
        self._seed(users_per_org=3)

        usernames = set(
            User.objects.filter(username__startswith="loadtest-user-")
            .values_list("username", flat=True)
        )
        self.assertEqual(usernames, {"loadtest-user-1", "loadtest-user-2", "loadtest-user-3"})

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
        self.assertFalse(User.objects.filter(username__startswith="loadtest-admin-").exists())
        self.assertTrue(Organization.objects.filter(pk=keeper.pk).exists())
        self.assertTrue(User.objects.filter(pk=keeper_user.pk).exists())

    def test_reset_and_reseed_in_one_call_spares_a_keepers_own_products_and_orders(self):
        """The reset test above (`orgs=0, users_per_org=0, products=0`) never
        actually seeds anything in the SAME call that deletes — it only proves
        the delete is prefix-scoped in isolation. The realistic Phase 2
        invocation (`seed.sh --reset`) does both in one command/transaction:
        `--reset` deletes every `loadtest-org-*`, and the very same call then
        reseeds a fresh one. That is the only path that both deletes AND
        writes, and the whole safety case of `--reset` rests on the delete's
        organization-name-prefix scoping never reaching a real customer org's
        OWN products/orders (not just its org/user rows) along the way.
        """
        keeper = _make_organization(name="RealOrg", identification_number="55555")
        keeper_user = User.objects.create_user(
            username="real-user", password="x", role=User.Role.COMPANY_USER, organization=keeper,
        )
        keeper_warehouse = Warehouse.objects.create(
            organization=keeper, code="RW1", name="Real Warehouse",
        )
        keeper_product = Product.objects.create(
            organization=keeper, sku="REAL-SKU-1", name="Real product",
            price=Decimal("5.00"), is_active=True,
        )
        keeper_order = PurchaseOrder.objects.create(
            organization=keeper, created_by=keeper_user, customer_name="Real customer",
            status=PurchaseOrder.Status.DRAFT,
        )
        self._seed()

        # Reset AND reseed in one call — not two separate ones.
        self._seed(reset=True)

        # The loadtest org was genuinely rebuilt from scratch...
        org = Organization.objects.get(name="loadtest-org-1")
        self.assertEqual(Product.objects.filter(organization=org).count(), 5)
        self.assertEqual(
            User.objects.filter(username__startswith="loadtest-user-").count(), 3,
        )
        # ...and the keeper's OWN rows survived the cascade untouched, not just
        # the keeper org/user pair the simpler reset test already covers.
        self.assertTrue(Organization.objects.filter(pk=keeper.pk).exists())
        self.assertTrue(User.objects.filter(pk=keeper_user.pk).exists())
        self.assertTrue(Warehouse.objects.filter(pk=keeper_warehouse.pk).exists())
        self.assertTrue(Product.objects.filter(pk=keeper_product.pk).exists())
        self.assertTrue(PurchaseOrder.objects.filter(pk=keeper_order.pk).exists())

    def test_products_carry_a_category_tree_and_image_urls(self):
        self._seed(products=5)

        product = Product.objects.filter(sku="LT-SKU-1").select_related("category").first()
        self.assertIsNotNone(product.category)
        self.assertEqual(len(product.category.path_names), 3)
        self.assertTrue(product.image_urls)
        self.assertIn("color", product.attributes)

    def test_orders_are_seeded_with_items(self):
        self._seed(orders=4)

        orders = PurchaseOrder.objects.filter(organization__name="loadtest-org-1")
        self.assertEqual(orders.count(), 4)
        self.assertTrue(all(o.items.exists() for o in orders))

    def test_orders_are_attributed_round_robin_across_company_users_not_the_admin(self):
        """OrderAnalyticsAPIView (core/views/analytics.py) groups its results by
        created_by. _company_admin() runs before _users() in handle(), so the
        admin always held the lowest id in the org — `.order_by("id").first()`
        used to attribute EVERY seeded order to that one admin account,
        collapsing the endpoint's GROUP BY to a single row no matter how many
        company users were seeded."""
        self._seed(users_per_org=3, orders=6)

        orders = PurchaseOrder.objects.filter(organization__name="loadtest-org-1")
        creator_usernames = set(orders.values_list("created_by__username", flat=True))

        self.assertGreater(len(creator_usernames), 1)
        self.assertNotIn("loadtest-admin-1", creator_usernames)
        self.assertEqual(
            creator_usernames, {"loadtest-user-1", "loadtest-user-2", "loadtest-user-3"},
        )

    def test_orders_are_spread_across_a_realistic_date_window(self):
        """created_at must not all land at the exact seeding moment.
        OrderAnalyticsAPIView defaults `date_from` to the 1st of the CURRENT
        month; if every seeded order shares one timestamp, the endpoint's
        result set is complete only until the next month boundary and then
        silently reports zero rows with no error — reporting its
        best-ever (and least honest) numbers."""
        self._seed(orders=10)

        orders = PurchaseOrder.objects.filter(organization__name="loadtest-org-1")
        timestamps = set(orders.values_list("created_at", flat=True))
        self.assertEqual(orders.count(), 10)
        self.assertGreater(len(timestamps), 1)
