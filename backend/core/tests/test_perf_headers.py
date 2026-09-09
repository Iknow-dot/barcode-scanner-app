from django.conf import settings
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.http import HttpResponse

from core.middleware.perf_headers import PerfHeadersMiddleware
from core.models import Organization


MIDDLEWARE_PATH = "core.middleware.perf_headers.PerfHeadersMiddleware"


class PerfHeadersFlagTests(SimpleTestCase):
    def test_middleware_is_absent_unless_the_flag_is_set(self):
        """The load-test instrument must cost nothing in every other environment."""
        self.assertFalse(settings.PERF_HEADERS_ENABLED)
        self.assertNotIn(MIDDLEWARE_PATH, settings.MIDDLEWARE)


class PerfHeadersMiddlewareTests(TestCase):
    def test_headers_report_zero_queries_for_a_view_that_touches_no_db(self):
        middleware = PerfHeadersMiddleware(lambda request: HttpResponse("ok"))
        response = middleware(RequestFactory().get("/"))

        self.assertEqual(response["X-Query-Count"], "0")
        # Both timings assert non-negative, not strictly positive. These are
        # wall-clock measurements of a view that does no work, and `:.3f`
        # renders anything under 0.0005 ms as "0.000". A strict `>` on the
        # total already flaked once (1aac666, fixed by widening the format from
        # .1f to .3f) and still clears the rounding floor by only ~12x. What
        # this test pins is the header being present and parseable.
        self.assertGreaterEqual(float(response["X-Db-Ms"]), 0.0)
        self.assertGreaterEqual(float(response["X-Total-Ms"]), 0.0)

    def test_query_count_matches_the_queries_the_view_actually_runs(self):
        Organization.objects.create(
            name="PerfOrg", identification_number="900900900",
            web_service_url="http://example.com/db", employees_count=1,
        )

        def view(request):
            list(Organization.objects.all())   # 1
            list(Organization.objects.all())   # 2
            return HttpResponse("ok")

        response = PerfHeadersMiddleware(view)(RequestFactory().get("/"))
        self.assertEqual(response["X-Query-Count"], "2")

    @override_settings(MIDDLEWARE=settings.MIDDLEWARE + [MIDDLEWARE_PATH],
                       SECURE_SSL_REDIRECT=False)
    def test_headers_appear_on_a_real_response_when_wired_in(self):
        response = self.client.get("/api/schema/")
        self.assertIn("X-Query-Count", response)
        self.assertIn("X-Total-Ms", response)
