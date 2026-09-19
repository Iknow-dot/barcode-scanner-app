from django.contrib.auth.backends import ModelBackend
from django.core.exceptions import PermissionDenied

from users import login_throttle


class ThrottledModelBackend(ModelBackend):
    """ModelBackend behind the failed-login lockout (``users.login_throttle``).

    Every password check goes through here: the JWT login and the Django
    admin both call ``authenticate()`` with the request.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if request is not None and login_throttle.retry_after(request, username or ''):
            # Stops authenticate() before the password is hashed or compared;
            # it then fires user_login_failed, which counts this attempt too.
            raise PermissionDenied
        user = super().authenticate(request, username=username, password=password, **kwargs)
        if user is not None and request is not None:
            login_throttle.clear(request, username or '')
        return user
