"""Per-response query count and timing headers, for load-test runs only.

k6 folds these into per-endpoint metrics, so a run summary reads
"catalog list: p95 900 ms, 340 queries" and an N+1 names itself instead of
needing a follow-up investigation.

Counting goes through ``connection.execute_wrapper`` rather than
``connection.queries``: the latter only records under DEBUG=True, and running
a load test with DEBUG on would distort the very numbers being measured.

Header names are Go-canonical (``X-Db-Ms``, not ``X-DB-Ms``) because k6
canonicalizes header keys and would otherwise read them as undefined.
"""
import time

from django.db import connection


class PerfHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        count = 0
        db_seconds = 0.0

        def wrapper(execute, sql, params, many, context):
            nonlocal count, db_seconds
            started = time.perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                count += 1
                db_seconds += time.perf_counter() - started

        request_started = time.perf_counter()
        with connection.execute_wrapper(wrapper):
            response = self.get_response(request)
        total_seconds = time.perf_counter() - request_started

        response["X-Query-Count"] = str(count)
        response["X-Db-Ms"] = f"{db_seconds * 1000:.1f}"
        response["X-Total-Ms"] = f"{total_seconds * 1000:.1f}"
        return response
