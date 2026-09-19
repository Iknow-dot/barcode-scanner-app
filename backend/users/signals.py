from django.contrib.auth.signals import user_login_failed
from django.dispatch import receiver

from users import login_throttle


@receiver(user_login_failed)
def count_failed_login(sender, credentials, request=None, **kwargs):
    if request is not None:
        login_throttle.record_failure(request, credentials.get('username') or '')
