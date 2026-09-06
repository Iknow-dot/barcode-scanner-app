from django.conf import settings
from django.contrib import admin
from django.template.response import TemplateResponse
from django.urls import path

from core.models import (
    Organization, OrganizationPushAllowedIP, Warehouse, PurchaseOrder,
    PurchaseOrderItem, Product, CatalogIngestState, ProductCategory,
    ProductAttribute,
)


class WarehouseInline(admin.StackedInline):
    model = Warehouse
    filter_horizontal = ["users"]
    extra = 1


class PushAllowedIPInline(admin.TabularInline):
    model = OrganizationPushAllowedIP
    extra = 1
    verbose_name = "Catalog push allowed IP"
    verbose_name_plural = "Catalog push IP allowlist (empty = unrestricted)"


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "identification_number", "employees_count")
    search_fields = ("name", "identification_number")

    inlines = [WarehouseInline, PushAllowedIPInline]

    readonly_fields = ("invoice_logo_preview",)

    fieldsets = (
        (None, {
            'fields': ('name', 'identification_number', 'employees_count'),
        }),
        ('External service (1C ConsultWebExchange)', {
            'fields': (
                'web_service_url', 'web_service_username', 'web_service_password',
                'retail_client_id_phone',
            ),
            'description': (
                'Retail counterparty ID/phone: the 1C ClientIDPhone used when '
                'pushing retail (clientless) orders via CreateOrder. While '
                'blank, retail orders confirm without a 1C push.'
            ),
        }),
        ('Invoice template', {
            'fields': (
                'invoice_logo_preview',
                'invoice_logo',
                'invoice_display_name',
                'invoice_address',
                'invoice_phone',
                'invoice_email',
                'invoice_footer_text',
            ),
        }),
        ('Security', {
            'fields': ('session_timeout_minutes',),
            'description': (
                'Idle session timeout in minutes (refresh-token lifetime). '
                'Blank = 1 day default. Min 30, max 43200 (30 days).'
            ),
        }),
    )

    def invoice_logo_preview(self, obj):
        from django.utils.html import format_html
        if obj and obj.invoice_logo:
            return format_html(
                '<img src="{}" style="max-height:80px;max-width:240px;" />',
                obj.invoice_logo,
            )
        return '(none)'
    invoice_logo_preview.short_description = 'Logo preview'


class PurchaseOrderItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 0
    readonly_fields = ("line_total",)


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ("id", "customer_name", "status", "external_order_number", "created_by", "created_at")
    list_filter = ("status", "organization")
    search_fields = (
        "customer_name", "customer_phone", "customer_identification_number",
        "external_order_number",
    )
    readonly_fields = ("external_order_number",)
    inlines = [PurchaseOrderItemInline]


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("sku", "name", "organization", "category", "is_active", "pushed_at")
    list_filter = ("organization", "is_active")
    search_fields = ("sku", "name", "article")


@admin.register(ProductCategory)
class ProductCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "external_id", "organization", "parent", "depth")
    list_filter = ("organization",)
    search_fields = ("name", "external_id")

    def depth(self, obj):
        return len(obj.path_names)


@admin.register(ProductAttribute)
class ProductAttributeAdmin(admin.ModelAdmin):
    list_display = ("key", "label", "organization", "is_visible", "order", "type", "first_seen_at")
    list_filter = ("organization", "is_visible")
    list_editable = ("label", "is_visible", "order")
    search_fields = ("key", "label")


@admin.register(CatalogIngestState)
class CatalogIngestStateAdmin(admin.ModelAdmin):
    list_display = ("organization", "status", "last_full_push_at", "last_delta_push_at", "last_delete_at", "images_failed")
    list_filter = ("status",)


# ---------------------------------------------------------------------------
# Custom admin view: PostHog Analytics Dashboard
# ---------------------------------------------------------------------------


def analytics_view(request):
    """Render the PostHog analytics dashboard inside the admin."""
    context = {
        **admin.site.each_context(request),
        "title": "Analytics",
        "posthog_dashboard_url": settings.POSTHOG_DASHBOARD_URL,
    }
    return TemplateResponse(request, "admin/analytics.html", context)


# Extend the default admin site with the analytics URL
_original_get_urls = admin.AdminSite.get_urls


def _patched_get_urls(self):
    custom_urls = [
        path("analytics/", self.admin_view(analytics_view), name="analytics"),
    ]
    return custom_urls + _original_get_urls(self)


admin.AdminSite.get_urls = _patched_get_urls
