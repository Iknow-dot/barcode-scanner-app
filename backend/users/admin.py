from django.contrib import admin
from users.models import AllowedIP
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from users.admin_forms import AdminUserCreationForm

User = get_user_model()


class AllowedIPInline(admin.TabularInline):
    model = AllowedIP
    extra = 1


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    inlines = [AllowedIPInline]
    add_form = AdminUserCreationForm

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
    )
