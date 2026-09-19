"""DRF rate limits that identify clients the way the IP allowlists do."""
import logging

from django.core.cache import caches
from rest_framework.exceptions import Throttled
from rest_framework.throttling import ScopedRateThrottle

from core.ip_utils import get_client_ip

logger = logging.getLogger(__name__)


class ClientIPScopedRateThrottle(ScopedRateThrottle):
    """ScopedRateThrottle that keys anonymous callers by ``get_client_ip``.

    DRF's own ``get_ident`` uses the whole X-Forwarded-For header while
    ``NUM_PROXIES`` is unset, and a client can vary that header per request to
    dodge the limit. Signed-in callers keep DRF's per-user key, so a shop
    behind one address does not share a single budget.

    Counters live in the shared ``throttle`` cache (``settings.CACHES``). A
    cache error fails open and is logged, as the login lockout does.
    """

    @property
    def cache(self):
        return caches['throttle']

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return super().get_cache_key(request, view)
        ident = get_client_ip(request)
        if ident is None:  # unknown address: don't pool everyone into one bucket
            return None
        return self.cache_format % {'scope': self.scope, 'ident': ident}

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except Exception:
            logger.exception('Rate-limit store unavailable; allowing the request')
            return True


class RateLimited(Throttled):
    """A 429 in the project's ``{"code", "detail"}`` error shape."""

    def __init__(self, wait=None):
        super().__init__(wait)
        self.detail = {'code': 'RATE_LIMITED', 'detail': str(self.detail)}
