import os

from cryptography.fernet import Fernet
from django.db import models
from django.contrib.auth import get_user_model



User = get_user_model()



class Organization(models.Model):
    name = models.CharField(max_length=255, unique=True)

    identification_number = models.CharField(max_length=50, unique=True)
    web_service_url = models.URLField(max_length=255)
    web_service_username = models.CharField(max_length=255, null=True, blank=True)
    web_service_password = models.CharField(max_length=255, null=True, blank=True)
    employees_count = models.PositiveIntegerField()

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

