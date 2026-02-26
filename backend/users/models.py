from django.db import models
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _


class User(AbstractUser):
    class Role(models.TextChoices):
        INTERNAL_ADMIN = ("internal_admin", _("Internal Admin"))
        COMPANY_ADMIN = ("company_admin", _("Company Admin"))
        COMPANY_USER = ("company_user", _("Company User"))

    organization = models.ForeignKey('core.Organization', on_delete=models.CASCADE, null=True, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.INTERNAL_ADMIN)

    def clean(self) -> None:
        if self.role == self.Role.INTERNAL_ADMIN and not (self.is_staff or self.is_superuser):
            raise ValidationError({
                "role": _("Internal Admin must have is_staff=True and is_superuser=True.")
            })
        if self.role in [self.Role.COMPANY_ADMIN, self.Role.COMPANY_USER] and not self.organization:
            raise ValidationError({
                "organization": _("Company Admin and Company User must be associated with an organization.")
            })
        if self.role == self.Role.INTERNAL_ADMIN and self.organization:
            raise ValidationError({
                "organization": _("Internal Admin should not be associated with any organization.")
            })
        super().clean()

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class AllowedIP(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='allowed_ips')
    ip_or_network = models.CharField(max_length=50, help_text='IP Address or Network')

    class Meta:
        unique_together = ('user', 'ip_or_network')