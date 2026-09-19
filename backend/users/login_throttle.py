"""Failed-login lockout, shared by the JWT login and the Django admin.

Only failures count (they arrive through Django's ``user_login_failed``
signal), so a shop full of consultants behind one NAT address can all log in
at shift start. Two fixed windows:

- username + client IP: stops guessing one account's password. Keyed by the
  pair, not the username alone, so nobody can lock a consultant out of their
  own shop by failing that username from somewhere else.
- client IP alone: stops one address spraying many usernames.

It is checked before the password is (``users.auth_backends`` and
``CustomTokenObtainPairView``). A locked-out attempt therefore costs no
password hash and reveals nothing about the password, which also defuses
IP_NOT_ALLOWED and DEVICE_NOT_ALLOWED: both are raised only after a correct
password.

State lives in the ``throttle`` cache, which every worker shares. Any cache
error fails open and is logged: a missing cache table must not stop a whole
sales floor from logging in.
"""
import hashlib
import logging
import math
import time

from django.core.cache import caches

from core.ip_utils import get_client_ip

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 15 * 60
PAIR_LIMIT = 5   # failures per username + client IP per window
IP_LIMIT = 30    # failures per client IP per window


def _cache():
    return caches['throttle']


def _digest(value) -> str:
    return hashlib.sha256(str(value).encode('utf-8')).hexdigest()[:32]


def _now() -> float:
    # Patched by tests. time.time itself is not: the cache backend reads it too.
    return time.time()


def _window() -> int:
    return int(_now() // WINDOW_SECONDS)


def _pair_key(request, username) -> str:
    ip = get_client_ip(request) or '-'
    return f'login-fail:pair:{_digest(f"{str(username).lower()}|{ip}")}:{_window()}'


def _limits(request, username):
    """(cache key, limit) for every counter this attempt falls under."""
    limits = [(_pair_key(request, username), PAIR_LIMIT)]
    ip = get_client_ip(request)
    if ip:  # an unknown address must not pool everyone into one counter
        limits.append((f'login-fail:ip:{_digest(ip)}:{_window()}', IP_LIMIT))
    return limits


def retry_after(request, username) -> int | None:
    """Seconds until this username + address may try again, or None if now."""
    try:
        cache = _cache()
        if any((cache.get(key) or 0) >= limit for key, limit in _limits(request, username)):
            return max(1, math.ceil(WINDOW_SECONDS - _now() % WINDOW_SECONDS))
    except Exception:
        logger.exception('Login throttle unavailable; allowing the attempt')
    return None


def record_failure(request, username) -> None:
    try:
        cache = _cache()
        for key, _ in _limits(request, username):
            # get + set rather than incr: incr keeps no explicit expiry on the
            # database backend, and a count lost to a race is harmless here.
            cache.set(key, (cache.get(key) or 0) + 1, 2 * WINDOW_SECONDS)
    except Exception:
        logger.exception('Login throttle unavailable; failure not counted')


def clear(request, username) -> None:
    """Forget this username + address's failures after a correct password.

    The per-address counter is kept: otherwise one valid account would let an
    address reset its own spraying count between guesses.
    """
    try:
        _cache().delete(_pair_key(request, username))
    except Exception:
        logger.exception('Login throttle unavailable; failures not cleared')
