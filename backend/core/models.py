import os

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

    # Sanitized HTML emitted by the in-app TipTap editor. Contains token
    # markers (`<span data-token="scope.name">`) and a single marked items
    # row (`<tr data-repeat="items">`) that the renderer clones per item.
    # Empty means "use the built-in default", so first-deploy orgs render
    # the same invoice they printed before this feature shipped.
    invoice_template_html = models.TextField(blank=True, default='')

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

    def __str__(self):
        return self.name



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

