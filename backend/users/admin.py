from django.contrib import admin
from django.utils.translation import gettext_lazy as _
from users.models import AllowedIP
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from users.admin_forms import AdminUserChangeForm, AdminUserCreationForm

User = get_user_model()


class AllowedIPInline(admin.TabularInline):
    model = AllowedIP
    extra = 1


class AllowedIPFilter(admin.SimpleListFilter):
    title = _('allowed IP')
    parameter_name = 'allowed_ip'

    def lookups(self, request, model_admin):
        ips = (
            AllowedIP.objects
            .values_list('ip_or_network', flat=True)
            .distinct()
            .order_by('ip_or_network')
        )
        return [(ip, ip) for ip in ips]

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(allowed_ips__ip_or_network=self.value()).distinct()
        return queryset


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    inlines = [AllowedIPInline]
    add_form = AdminUserCreationForm
    form = AdminUserChangeForm

    list_display = DjangoUserAdmin.list_display + ('role', 'organization')
    list_filter = DjangoUserAdmin.list_filter + ('organization', 'warehouses', 'role', AllowedIPFilter)
    search_fields = DjangoUserAdmin.search_fields + ('organization__name',)
    readonly_fields = ('device_bound_at', 'device_label')

    # Add role and organization to the user creation form
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        ("Role & Organization", {
            "fields": ("role", "organization", "is_staff", "is_superuser"),
        }),
    )

    fieldsets = DjangoUserAdmin.fieldsets + (
        ("Role & Organization", {
            "fields": ("role", "organization"),
        }),
        ("Discounts", {
            "fields": ("can_apply_discount", "max_discount_percent"),
            "description": (
                "Toggle whether this user can apply discounts to order items, "
                "and set the maximum discount percent they are permitted to "
                "use (also applies to manually-entered 'set price' overrides)."
            ),
        }),
        ("Device lock", {
            "fields": ("device_lock_enabled", "bound_device_id",
                       "device_bound_at", "device_label"),
            "description": (
                "When enabled, the account binds to the first device that "
                "logs in and can only sign in from it. Clear bound_device_id "
                "to let the user re-bind from a new device."
            ),
        }),
    )
