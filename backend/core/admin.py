from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from users.models import AllowedIP

User = get_user_model()


class AllowedIPInline(admin.TabularInline):
    model = AllowedIP
    extra = 1


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    inlines = [AllowedIPInline]

