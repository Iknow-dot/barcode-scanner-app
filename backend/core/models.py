import os
import secrets

from cryptography.fernet import Fernet
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone



User = get_user_model()



class Organization(models.Model):
    name = models.CharField(max_length=255, unique=True)

    identification_number = models.CharField(max_length=50, unique=True)
    web_service_url = models.URLField(max_length=255)
    web_service_username = models.CharField(max_length=255, null=True, blank=True)
    web_service_password = models.CharField(max_length=255, null=True, blank=True)
    webhook_token = models.CharField(
        max_length=64, unique=True, db_index=True, default=secrets.token_urlsafe,
    )
    employees_count = models.PositiveIntegerField()

    # Invoice template — rendered into the printable invoice HTML.
    # Logo is stored as a base64 data URL (size-capped server-side); other
    # fields are optional and fall back gracefully in the template.
    invoice_logo = models.TextField(blank=True, default='')
    invoice_display_name = models.CharField(max_length=255, blank=True, default='')
    invoice_address = models.TextField(blank=True, default='')
    invoice_phone = models.CharField(max_length=50, blank=True, default='')
    invoice_email = models.EmailField(blank=True, default='')
    invoice_footer_text = models.TextField(blank=True, default='')

    # HTML emitted by the in-app TipTap editor (sanitized at the
    # serializer layer before persistence — this field stores whatever
    # the serializer wrote, treat it as trusted). Contains token
    # markers (`<span data-token="scope.name">`) and a single marked items
    # row (`<tr data-repeat="items">`) that the renderer clones per item.
    # Empty means "use the built-in default", so first-deploy orgs render
    # the same invoice they printed before this feature shipped.
    invoice_template_html = models.TextField(blank=True, default='')

    # Consultants may mark order line items as gifts (ClickUp 86ca495uu).
    # Off by default — most organizations don't use gift marking.
    gift_marking_enabled = models.BooleanField(default=False)

    @property
    def non_admin_user_count(self) -> int:
        """Return the number of non-admin (company_user) users in this organization."""
        return self.users.filter(role=User.Role.COMPANY_USER).count()

    def has_reached_user_limit(self) -> bool:
        """Check whether the organization has reached its allowed user limit.

        Only users with the ``company_user`` role count towards the limit;
        admin users are excluded.
        """
        return self.non_admin_user_count >= self.employees_count

    def encrypt_password(self, password: str) -> None:
        """Encrypt and store the web-service password using Fernet symmetric encryption."""
        key = os.getenv('FERNET_KEY')
        if not key:
            raise ValueError("FERNET_KEY is not set or is invalid")
        cipher_suite = Fernet(key)
        self.web_service_password = cipher_suite.encrypt(password.encode()).decode()

    def decrypt_password(self) -> str:
        """Decrypt and return the stored web-service password."""
        key = os.getenv('FERNET_KEY')
        if not key:
            raise ValueError("FERNET_KEY is not set or is invalid")
        cipher_suite = Fernet(key)
        return cipher_suite.decrypt(self.web_service_password.encode()).decode()

    def rotate_webhook_token(self) -> None:
        self.webhook_token = secrets.token_urlsafe()
        self.save(update_fields=["webhook_token"])

    def __str__(self):
        return self.name


class OrganizationPushAllowedIP(models.Model):
    """Optional source-IP allowlist for the organization's catalog push token.

    Mirrors the per-user ``users.AllowedIP`` pattern, scoped to the org and
    enforced on the catalog-ingest endpoints. No rows → pushes are unrestricted;
    any rows → a push is only accepted from a client IP matching one of them
    (exact IP or CIDR network).
    """
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='push_allowed_ips',
    )
    ip_or_network = models.CharField(
        max_length=50, help_text='IP address or CIDR network allowed to push the catalog',
    )

    class Meta:
        unique_together = ('organization', 'ip_or_network')

    def __str__(self):
        return f"{self.organization.name}: {self.ip_or_network}"


class Product(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="products")
    sku = models.CharField(max_length=255)
    article = models.CharField(max_length=255, blank=True, default="")
    name = models.CharField(max_length=512)
    price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    image_urls = models.JSONField(default=list, blank=True)
    row_hash = models.CharField(max_length=64, blank=True, default="")
    is_active = models.BooleanField(default=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    pushed_at = models.DateTimeField(null=True, blank=True)
    category = models.ForeignKey(
        "ProductCategory", null=True, blank=True, on_delete=models.SET_NULL, related_name="products",
    )
    attributes = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "sku"], name="uq_product_org_sku")]

    def __str__(self):
        return f"{self.name} ({self.sku})"


class ProductBarcode(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="barcodes")
    barcode = models.CharField(max_length=255, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "barcode"], name="uq_barcode_per_product")]


class ProductCategory(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="product_categories",
    )
    external_id = models.CharField(max_length=255)  # stable 1C category id
    name = models.CharField(max_length=512, blank=True, default="")
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children",
    )
    path = models.CharField(max_length=1024, blank=True, default="")  # stable id-path, e.g. /7/42/
    path_names = models.JSONField(default=list, blank=True)           # root->leaf display names

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "external_id"], name="uq_category_org_extid"),
        ]

    def __str__(self):
        return f"{self.name} ({self.external_id})"


class ProductAttribute(models.Model):
    """Per-org display registry for dynamic product attributes. Metadata only —
    holds no values; those live in Product.attributes."""
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="product_attributes",
    )
    key = models.CharField(max_length=128)
    label = models.CharField(max_length=255, blank=True, default="")
    order = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=False)  # hidden until an admin approves
    type = models.CharField(max_length=16, blank=True, default="text")  # display hint, never enforced
    first_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "key"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "key"], name="uq_attribute_org_key"),
        ]

    def __str__(self):
        return f"{self.key} ({self.organization_id})"


class CatalogIngestState(models.Model):
    organization = models.OneToOneField(Organization, on_delete=models.CASCADE, related_name="catalog_ingest_state")
    last_full_push_at = models.DateTimeField(null=True, blank=True)
    last_delta_push_at = models.DateTimeField(null=True, blank=True)
    last_delete_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, default="ok")  # ok | stale | error
    last_error = models.TextField(blank=True, default="")
    received = models.PositiveIntegerField(default=0)      # counts of the last push
    upserted = models.PositiveIntegerField(default=0)
    deactivated = models.PositiveIntegerField(default=0)
    images_failed = models.PositiveIntegerField(default=0)

    STALE_AFTER = timezone.timedelta(days=2)

    @property
    def is_stale(self) -> bool:
        last = self.last_delta_push_at or self.last_full_push_at
        return last is None or (timezone.now() - last) > self.STALE_AFTER


class Warehouse(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='warehouses')
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=255)
    users = models.ManyToManyField(
        User,
        related_name='warehouses',
        limit_choices_to=models.Q(organization=models.F('organization')),
        blank=True
    )

    class Meta:
        unique_together = ('organization', 'code')

    def __str__(self):
        return f"{self.name} ({self.code}) - {self.organization.name}"


class PurchaseOrder(models.Model):
    """A purchase order created by a company user, linked to a customer."""

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        CONFIRMED = 'confirmed', 'Confirmed'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    class DeliveryType(models.TextChoices):
        PICKUP = 'pickup', 'Pickup'
        DELIVERY = 'delivery', 'Delivery'

    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name='purchase_orders',
    )
    # Denormalized client fields — sourced from 1C ConsultWebExchange and stored
    # on the order so historical data survives even after the legacy local
    # Customer model is dropped.
    customer_name = models.CharField(max_length=255, blank=True, default='')
    customer_phone = models.CharField(max_length=50, blank=True, default='')
    customer_identification_number = models.CharField(
        max_length=50, blank=True, default='', db_index=True,
    )
    external_client_id = models.CharField(
        max_length=128, blank=True, default='', db_index=True,
    )
    # True when the order has no client and maps to the 1C retail counterparty
    # (საცალო კონტრაგენტი). Client fields above stay blank for retail orders.
    is_retail = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_orders',
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    # Delivery conditions
    delivery_type = models.CharField(
        max_length=20,
        choices=DeliveryType.choices,
        default=DeliveryType.PICKUP,
    )
    delivery_address = models.CharField(max_length=500, blank=True, default='')
    delivery_date = models.DateField(null=True, blank=True)
    delivery_time_from = models.TimeField(null=True, blank=True)
    delivery_time_to = models.TimeField(null=True, blank=True)
    delivery_notes = models.TextField(blank=True, default='')

    # Recipient: when False, the buyer (customer_*) receives the product.
    # When True, the recipient_* fields below hold a third-party recipient.
    recipient_is_different = models.BooleanField(default=False)
    recipient_first_name = models.CharField(max_length=128, blank=True, default='')
    recipient_last_name = models.CharField(max_length=128, blank=True, default='')
    recipient_phone = models.CharField(max_length=50, blank=True, default='')

    # General notes / comments
    notes = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Order #{self.pk} — {self.customer_name or '(no client)'} ({self.status})"

    @property
    def total(self):
        return sum(item.line_total for item in self.items.all())


class PurchaseOrderItem(models.Model):
    """A line item in a purchase order, representing a scanned product."""
    order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name='items',
    )
    sku = models.CharField(max_length=255)
    sku_name = models.CharField(max_length=255, blank=True, default='')
    article = models.CharField(max_length=255, blank=True, default='')
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    quantity = models.PositiveIntegerField(default=1)

    # Warehouse from which the product is sourced
    warehouse_code = models.CharField(max_length=255, blank=True, default='')
    warehouse_name = models.CharField(max_length=255, blank=True, default='')

    # Unit of measure (e.g. piece, box, pallet)
    unit = models.CharField(max_length=50, blank=True, default='')

    # Discount
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    discounted_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Informational gift mark — never affects effective_price / line_total.
    is_gift = models.BooleanField(default=False)

    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['added_at']

    def __str__(self):
        return f"{self.sku_name or self.sku} x{self.quantity}"

    @property
    def effective_price(self):
        """Return the discounted price if set, otherwise calculate from discount_percent."""
        if self.discounted_price is not None:
            return self.discounted_price
        if self.discount_percent and self.discount_percent > 0:
            from decimal import Decimal
            return self.price * (Decimal('1') - self.discount_percent / Decimal('100'))
        return self.price

    @property
    def line_total(self):
        return self.effective_price * self.quantity

