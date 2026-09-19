from django.contrib.auth.backends import ModelBackend
from django.core.exceptions import PermissionDenied

from users import login_throttle


class ThrottledModelBackend(ModelBackend):
    """ModelBackend behind the failed-login lockout (``users.login_throttle``).

    Every password check goes through here: the JWT login and the Django
    admin both call ``authenticate()`` with the request.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if request is None:
            return super().authenticate(request, username=username, password=password, **kwargs)
        name = username or ''
        if login_throttle.retry_after(request, name):
            # Stops authenticate() before the password is hashed or compared.
            raise PermissionDenied
        # Counted before the slow hash, so attempts already in flight see it.
        login_throttle.reserve_attempt(request, name)
        user = super().authenticate(request, username=username, password=password, **kwargs)
        if user is not None:
            login_throttle.release_attempt(request, name)
        return user
