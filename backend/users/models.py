from django.db import models
from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    class Role(models.TextChoices):
        SUPER_ADMIN = ("super_admin", "Super Admin")
        COMPANY_ADMIN = ("company_admin", "Company Admin")
        COMPANY_USER = ("company_user", "Company User")

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.COMPANY_USER)


class AllowedIP(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='allowed_ips')
    ip_or_network = models.CharField(max_length=50, help_text='IP Address or Network')

    class Meta:
        unique_together = ('user', 'ip_or_network')