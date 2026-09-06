"""Core test suite.

Split by resource, mirroring ``core/views/``. Django discovers ``test_*.py``
inside this package automatically; ``common.py`` holds shared fixtures and is
deliberately not named ``test_*`` so the runner does not treat it as a module
of tests.

Run one module:  uv run python manage.py test core.tests.test_orders
Run one class:   uv run python manage.py test core.tests.test_orders.RetailOrderAPITests
"""
