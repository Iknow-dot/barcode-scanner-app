"""Failed-login lockout, shared by the JWT login and the Django admin.

Only failures count, so a shop full of consultants behind one NAT address
can all log in at shift start. An attempt is counted *before* its password is
checked and the count is given back if the password is right: counting only
afterwards let every attempt already in flight past the check (8 parallel
guesses got 10-16 tries instead of 5). Two fixed windows:

- username + client IP: stops guessing one account's password. Keyed by the
  pair, not the username alone, so nobody can lock a consultant out of their
  own shop by failing that username from somewhere else.
- client IP alone: stops one address spraying many usernames.

IPv6 addresses count per /64: one host holds the whole block, and a fresh
address per guess would otherwise start a fresh count.

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
import ipaddress
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


def _address(request) -> str | None:
    """The client address a counter is keyed by: IPv4 as is, IPv6 as its /64."""
    ip = get_client_ip(request)
    if ip is None:
        return None
    parsed = ipaddress.ip_address(ip)  # get_client_ip returns only valid addresses
    if parsed.version == 6:
        if parsed.ipv4_mapped:
            return str(parsed.ipv4_mapped)
        return str(ipaddress.ip_network(f'{parsed}/64', strict=False))
    return str(parsed)


def _pair_key(request, username) -> str:
    address = _address(request) or '-'
    return f'login-fail:pair:{_digest(f"{str(username).lower()}|{address}")}:{_window()}'


def _ip_key(request) -> str | None:
    address = _address(request)
    # An unknown address must not pool everyone into one counter.
    return f'login-fail:ip:{_digest(address)}:{_window()}' if address else None


def _limits(request, username):
    """(cache key, limit) for every counter this attempt falls under."""
    limits = [(_pair_key(request, username), PAIR_LIMIT)]
    ip_key = _ip_key(request)
    if ip_key:
        limits.append((ip_key, IP_LIMIT))
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


def reserve_attempt(request, username) -> None:
    """Count this attempt as a failure before its password is checked."""
    try:
        cache = _cache()
        for key, _ in _limits(request, username):
            # get + set rather than incr: incr keeps no explicit expiry on the
            # database backend. The race window is now milliseconds, not the
            # length of a password hash.
            cache.set(key, (cache.get(key) or 0) + 1, 2 * WINDOW_SECONDS)
    except Exception:
        logger.exception('Login throttle unavailable; attempt not counted')


def release_attempt(request, username) -> None:
    """The password was right: give back this attempt's reservation.

    The username + address failures are forgotten. The per-address counter
    only loses this one attempt: resetting it would let one valid account wipe
    an address's spraying count between guesses.
    """
    try:
        cache = _cache()
        cache.delete(_pair_key(request, username))
        ip_key = _ip_key(request)
        if ip_key:
            count = cache.get(ip_key) or 0
            if count > 0:
                cache.set(ip_key, count - 1, 2 * WINDOW_SECONDS)
    except Exception:
        logger.exception('Login throttle unavailable; attempt not released')
