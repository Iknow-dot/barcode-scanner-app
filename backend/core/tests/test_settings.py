"""Settings the deployment depends on that no endpoint test exercises."""
from django.conf import settings
from django.test import SimpleTestCase


class DatabaseSettingsTests(SimpleTestCase):
    def test_server_side_cursors_are_off_for_the_transaction_pool(self):
        # Production reaches Postgres through a PgBouncer pool in transaction
        # mode, where a server-side cursor (QuerySet.iterator()) outlives the
        # transaction whose server connection it lives on.
        self.assertTrue(settings.DATABASES['default'].get('DISABLE_SERVER_SIDE_CURSORS'))
