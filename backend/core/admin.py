import os

from django.contrib import admin
from django.template.response import TemplateResponse
from django.urls import path

from core.models import Organization, Warehouse


class WarehouseInline(admin.StackedInline):
    model = Warehouse
    filter_horizontal = ["users"]
    extra = 1


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "identification_number", "employees_count")
    search_fields = ("name", "identification_number")

    inlines = [WarehouseInline]


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
