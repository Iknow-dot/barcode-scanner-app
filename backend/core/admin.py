import os

from django.contrib import admin
from django.template.response import TemplateResponse
from django.urls import path

from core.models import Organization, Warehouse, PurchaseOrder, PurchaseOrderItem


class WarehouseInline(admin.StackedInline):
    model = Warehouse
    filter_horizontal = ["users"]
    extra = 1


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "identification_number", "employees_count")
    search_fields = ("name", "identification_number")

    inlines = [WarehouseInline]

    readonly_fields = ("invoice_logo_preview",)

    fieldsets = (
        (None, {
            'fields': ('name', 'identification_number', 'employees_count'),
        }),
        ('External service (1C ConsultWebExchange)', {
            'fields': ('web_service_url', 'web_service_username', 'web_service_password'),
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
    list_display = ("id", "customer_name", "status", "created_by", "created_at")
    list_filter = ("status", "organization")
    search_fields = ("customer_name", "customer_phone", "customer_identification_number")
    inlines = [PurchaseOrderItemInline]


# ---------------------------------------------------------------------------
# Custom admin view: PostHog Analytics Dashboard
# ---------------------------------------------------------------------------


def analytics_view(request):
    """Render the PostHog analytics dashboard inside the admin."""
    context = {
        **admin.site.each_context(request),
        "title": "Analytics",
        "posthog_dashboard_url": os.getenv("POSTHOG_DASHBOARD_URL", ""),
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
