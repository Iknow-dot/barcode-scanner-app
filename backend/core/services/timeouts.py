"""One HTTP timeout budget for every outbound client.

`httpx` applies a scalar `timeout=` to connect, read, write and pool
*separately*, so `timeout=15` permits a single call to run for far longer than
15 seconds. That matters here because the platform router in front of the app
abandons a request after 60 seconds (DigitalOcean App Platform) and answers the
browser with its own 502 page — our response, and any error handling in it, is
discarded, while the worker keeps running and the upstream write still lands.
That is how a client registration could return an error and create the client.

Request payloads on all three integrations are small, so only the read phase
needs a real budget; the rest are short and fixed, keeping the worst case well
under the router's limit.
"""

import httpx

CONNECT_TIMEOUT = 5.0
WRITE_TIMEOUT = 5.0
POOL_TIMEOUT = 5.0

# Every phase of one call, worst case, must stay under this.
ROUTER_TIMEOUT_SECONDS = 60.0


def budget(read: float) -> httpx.Timeout:
    """A per-phase timeout whose worst case is bounded, not a scalar."""
    return httpx.Timeout(
        read,
        connect=CONNECT_TIMEOUT,
        write=WRITE_TIMEOUT,
        pool=POOL_TIMEOUT,
    )
