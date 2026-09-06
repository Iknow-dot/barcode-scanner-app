"""Shared serializer helpers: the user model alias."""

from django.contrib.auth import get_user_model

User = get_user_model()
