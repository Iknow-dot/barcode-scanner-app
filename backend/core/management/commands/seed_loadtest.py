"""Seed a repeatable dataset for k6 load-test runs.

Four constraints here silently invalidate a whole run if missed, so they are
asserted by core/tests/test_seed_loadtest.py:

* ``device_lock_enabled=False`` — device lock is trust-on-first-use, so the
  first VU binds the device and every other VU gets 403 DEVICE_NOT_ALLOWED.
* no ``AllowedIP`` rows — otherwise every login fails IP_NOT_ALLOWED.
* the password is hashed **once** and the hash reused; ``set_password`` per user
  would run one PBKDF2 round per user and dominate seed time.
* ``employees_count`` covers the seeded users, so admin flows against a seeded
  org do not hit USER_LIMIT_REACHED.

Teardown is organization-scoped. ``--reset`` deletes only organizations whose
name starts with ORG_PREFIX; User.organization is on_delete=CASCADE, so their
users go with them. Nothing here truncates a table — the same command runs
against the staging database in Phase 2, which holds data worth keeping.
"""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core.models import (
    Organization,
    Product,
    ProductAttribute,
    ProductBarcode,
    ProductCategory,
    PurchaseOrder,
    PurchaseOrderItem,
    Warehouse,
)
from users.models import User

ORG_PREFIX = "loadtest-org-"
USER_PREFIX = "loadtest-user-"
ADMIN_PREFIX = "loadtest-admin-"
SKU_PREFIX = "LT-SKU-"
WAREHOUSE_PREFIX = "LT-W"
ORDER_CUSTOMER_PREFIX = "Loadtest customer "
# Seeded orders are spread across this many days back from "now" (seeding
# time) so OrderAnalyticsAPIView's default date_from (the 1st of the CURRENT
# month) doesn't profile an empty result set the moment a month boundary
# passes — see _orders()'s own comment.
ORDER_WINDOW_DAYS = 90

DEFAULT_PASSWORD = "loadtest-pass-1234"
DEFAULT_1C_PASSWORD = "loadtest-1c-password"
DEFAULT_WEB_SERVICE_URL = "http://fake-1c:8099"

# Root -> mid -> leaf, so every product carries a three-deep breadcrumb.
CATEGORY_TREE = [
    ("100", "Kitchen", "110", "Pans", "111", "Cast iron pans"),
    ("200", "Drinks", "210", "Coffee", "211", "Ground coffee"),
]


class Command(BaseCommand):
    help = "Seed organizations, users, warehouses, products and orders for a k6 load-test run."

    def add_arguments(self, parser):
        parser.add_argument("--orgs", type=int, default=1)
        parser.add_argument("--users-per-org", type=int, default=50)
        parser.add_argument("--warehouses-per-org", type=int, default=3)
        parser.add_argument("--products", type=int, default=5000,
                            help="Products per organization.")
        parser.add_argument("--orders", type=int, default=200,
                            help="Draft orders per organization, each with 3 items.")
        parser.add_argument("--password", default=DEFAULT_PASSWORD)
        parser.add_argument("--web-service-url", default=DEFAULT_WEB_SERVICE_URL)
        parser.add_argument("--reset", action="store_true",
                            help="Delete the seeded organizations (and, by cascade, their "
                                 "users, warehouses, products and orders) before seeding.")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset"]:
            deleted, _ = Organization.objects.filter(name__startswith=ORG_PREFIX).delete()
            self.stdout.write(f"reset: removed {deleted} rows under {ORG_PREFIX}*")

        password_hash = make_password(options["password"])
        user_number = 0

        for org_index in range(1, options["orgs"] + 1):
            org = self._organization(org_index, options)
            warehouses = self._warehouses(org, options["warehouses_per_org"])
            self._company_admin(org, org_index, warehouses, password_hash)
            user_number = self._users(
                org, warehouses, options["users_per_org"], password_hash, user_number,
            )
            categories = self._categories(org)
            self._products(org, categories, options["products"])
            self._orders(org, warehouses, options["orders"])

        self.stdout.write(self.style.SUCCESS(
            f"seeded {options['orgs']} org(s), {user_number} user(s), "
            f"{options['products']} product(s) each"
        ))

    # -- pieces -----------------------------------------------------------

    def _organization(self, index, options):
        org, _ = Organization.objects.update_or_create(
            name=f"{ORG_PREFIX}{index}",
            defaults={
                "identification_number": f"LT{index:09d}",
                "web_service_url": options["web_service_url"],
                "web_service_username": "loadtest",
                # employees_count only caps company_user accounts
                # (Organization.non_admin_user_count / has_reached_user_limit) — the
                # one company_admin seeded per org below never counts against it, so
                # this headroom does not need to account for the admin.
                "employees_count": max(options["users_per_org"], 1) * 10,
                "product_catalog_enabled": True,
                "gift_marking_enabled": True,
                "webhook_token": f"loadtest-push-token-{index}",
            },
        )
        org.encrypt_password(DEFAULT_1C_PASSWORD)
        org.save(update_fields=["web_service_password"])
        return org

    def _warehouses(self, org, count):
        warehouses = []
        for i in range(1, count + 1):
            warehouse, _ = Warehouse.objects.update_or_create(
                organization=org, code=f"{WAREHOUSE_PREFIX}{i}",
                defaults={"name": f"Loadtest Warehouse {i}"},
            )
            warehouses.append(warehouse)
        return warehouses

    def _company_admin(self, org, org_index, warehouses, password_hash):
        """One company_admin per org, numbered by org index (not the globally
        sequential company_user numbering below) — endpoints gated by
        IsCompanyAdmin (e.g. catalog/sync-status/, analytics/orders/) 403 every
        company_user, so a k6 scenario hitting those needs an admin account."""
        admin, _ = User.objects.update_or_create(
            username=f"{ADMIN_PREFIX}{org_index}",
            defaults={
                "password": password_hash,
                "role": User.Role.COMPANY_ADMIN,
                "organization": org,
                "device_lock_enabled": False,
                "bound_device_id": "",
                "can_apply_discount": True,
                "max_discount_percent": Decimal("50.00"),
                "is_active": True,
            },
        )
        admin.allowed_ips.all().delete()
        admin.warehouses.set(warehouses)
        return admin

    def _users(self, org, warehouses, count, password_hash, start_number):
        number = start_number
        for _ in range(count):
            number += 1
            user, _ = User.objects.update_or_create(
                username=f"{USER_PREFIX}{number}",
                defaults={
                    "password": password_hash,
                    "role": User.Role.COMPANY_USER,
                    "organization": org,
                    "device_lock_enabled": False,
                    "bound_device_id": "",
                    "can_apply_discount": True,
                    "max_discount_percent": Decimal("50.00"),
                    "is_active": True,
                },
            )
            user.allowed_ips.all().delete()
            user.warehouses.set(warehouses)
        return number

    def _categories(self, org):
        """Returns the leaf categories products are attached to."""
        leaves = []
        for root_id, root_name, mid_id, mid_name, leaf_id, leaf_name in CATEGORY_TREE:
            root, _ = ProductCategory.objects.update_or_create(
                organization=org, external_id=root_id,
                defaults={"name": root_name, "parent": None,
                          "path": f"/{root_id}/", "path_names": [root_name]},
            )
            mid, _ = ProductCategory.objects.update_or_create(
                organization=org, external_id=mid_id,
                defaults={"name": mid_name, "parent": root,
                          "path": f"/{root_id}/{mid_id}/",
                          "path_names": [root_name, mid_name]},
            )
            leaf, _ = ProductCategory.objects.update_or_create(
                organization=org, external_id=leaf_id,
                defaults={"name": leaf_name, "parent": mid,
                          "path": f"/{root_id}/{mid_id}/{leaf_id}/",
                          "path_names": [root_name, mid_name, leaf_name]},
            )
            leaves.append(leaf)
        ProductAttribute.objects.update_or_create(
            organization=org, key="color",
            defaults={"label": "Colour", "is_visible": True, "order": 1},
        )
        ProductAttribute.objects.update_or_create(
            organization=org, key="diameter_cm",
            defaults={"label": "Diameter", "is_visible": True, "order": 2},
        )
        return leaves

    def _products(self, org, categories, count):
        existing = set(
            Product.objects.filter(organization=org).values_list("sku", flat=True)
        )
        new_products = []
        for i in range(1, count + 1):
            sku = f"{SKU_PREFIX}{i}"
            if sku in existing:
                continue
            new_products.append(Product(
                organization=org,
                sku=sku,
                article=f"LT-ART-{i}",
                name=f"Loadtest product {i} pan coffee",
                price=Decimal("9.90") + Decimal(i % 50),
                image_urls=[f"http://fake-1c:8099/img/{i}-0.jpg",
                            f"http://fake-1c:8099/img/{i}-1.jpg"],
                category=categories[i % len(categories)],
                attributes={"color": "black" if i % 2 else "red",
                            "diameter_cm": str(20 + (i % 10))},
                is_active=True,
            ))
        Product.objects.bulk_create(new_products, batch_size=1000)

        # Barcodes for the products just created; existing ones already have theirs.
        created = Product.objects.filter(
            organization=org, sku__in=[p.sku for p in new_products],
        ).values_list("id", "sku")
        ProductBarcode.objects.bulk_create(
            [
                ProductBarcode(product_id=pk, barcode=f"48600{int(sku.rsplit('-', 1)[1]):08d}")
                for pk, sku in created
            ],
            batch_size=1000,
        )

    def _orders(self, org, warehouses, count):
        if not count:
            return
        # Round-robin across the seeded COMPANY users only — never the admin.
        # _company_admin() runs before _users() in handle(), so the admin
        # always holds the lowest id in the org; the previous
        # `.order_by("id").first()` therefore attributed EVERY seeded order
        # to that one admin account. OrderAnalyticsAPIView
        # (core/views/analytics.py) groups its results by created_by, so that
        # collapsed the whole GROUP BY to a single row no matter how many
        # company users were seeded — degenerate for the one endpoint RULING
        # R13 added the admin to help measure, not something the admin's
        # existence was ever meant to cause.
        creators = list(
            User.objects.filter(organization=org, role=User.Role.COMPANY_USER).order_by("id")
        )
        if not creators:
            # Only reachable with users_per_org=0 (a narrow test) — fall back
            # to whichever user exists so orders still get a valid creator FK.
            creators = list(User.objects.filter(organization=org).order_by("id"))
        existing = PurchaseOrder.objects.filter(
            organization=org, customer_name__startswith=ORDER_CUSTOMER_PREFIX,
        ).count()
        skus = list(
            Product.objects.filter(organization=org).order_by("id")
            .values_list("sku", "name", "price")[:100]
        )
        if not skus:
            return
        now = timezone.now()
        new_orders = []
        for i in range(existing + 1, count + 1):
            order = PurchaseOrder.objects.create(
                organization=org,
                created_by=creators[i % len(creators)] if creators else None,
                customer_name=f"{ORDER_CUSTOMER_PREFIX}{i}",
                customer_phone=f"5{i:08d}",
                status=PurchaseOrder.Status.DRAFT,
            )
            new_orders.append((order, i))
            PurchaseOrderItem.objects.bulk_create([
                PurchaseOrderItem(
                    order=order,
                    sku=sku, sku_name=name, price=price or Decimal("1.00"),
                    quantity=1 + (n % 3),
                    warehouse_code=warehouses[n % len(warehouses)].code,
                    warehouse_name=warehouses[n % len(warehouses)].name,
                )
                for n, (sku, name, price) in enumerate(skus[(i * 3) % len(skus):][:3] or skus[:3])
            ])

        # created_at is auto_now_add (core/models.py::PurchaseOrder), which
        # blocks setting it at INSERT time — this follow-up bulk_update is a
        # deliberate second write, not a workaround for a mistake above. It
        # spreads the seeded orders across ORDER_WINDOW_DAYS instead of
        # leaving every one stamped at the exact moment seeding ran: without
        # this, OrderAnalyticsAPIView's default `date_from` (the 1st of the
        # CURRENT month) profiles the full seeded set only until the next
        # month boundary, then silently measures an empty result set with no
        # error — reporting the endpoint's best-ever (and least honest)
        # numbers. bulk_update() issues a raw UPDATE, so it does not re-run
        # auto_now_add.
        for order, i in new_orders:
            order.created_at = now - timedelta(
                days=i % ORDER_WINDOW_DAYS, hours=(i * 7) % 24, minutes=(i * 13) % 60,
            )
        if new_orders:
            PurchaseOrder.objects.bulk_update([o for o, _ in new_orders], ["created_at"])
