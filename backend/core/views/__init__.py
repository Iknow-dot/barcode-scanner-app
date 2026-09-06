"""Core API views.

Split by resource, mirroring the route groups in ``core/urls.py``. This
module re-exports the public view classes so ``from core.views import X``
keeps working for urls.py, schema.py and any external importer.
"""

from core.views.analytics import OrderAnalyticsAPIView
from core.views.catalog_ingest import (
    CatalogProductDeactivateAPIView,
    CatalogProductIngestAPIView,
    OrderCompleteWebhookAPIView,
)
from core.views.catalog_read import (
    CatalogCategoryTreeAPIView,
    CatalogProductImageAPIView,
    CatalogProductListAPIView,
    CatalogProductSearchAPIView,
    CatalogSyncStatusAPIView,
)
from core.views.clients import (
    CheckClientAPIView,
    CreateClientAPIView,
    ReverseGeocodeAPIView,
    RSGeLookupAPIView,
    SearchAddressesAPIView,
)
from core.views.invoices import InvoiceSampleValuesAPIView, InvoiceTokensAPIView
from core.views.orders import PurchaseOrderViewSet
from core.views.organizations import OrganizationViewSet
from core.views.products import ProductSearchAPIView
from core.views.warehouses import WarehouseViewSet

__all__ = [
    'CatalogCategoryTreeAPIView',
    'CatalogProductDeactivateAPIView',
    'CatalogProductImageAPIView',
    'CatalogProductIngestAPIView',
    'CatalogProductListAPIView',
    'CatalogProductSearchAPIView',
    'CatalogSyncStatusAPIView',
    'CheckClientAPIView',
    'CreateClientAPIView',
    'InvoiceSampleValuesAPIView',
    'InvoiceTokensAPIView',
    'OrderAnalyticsAPIView',
    'OrderCompleteWebhookAPIView',
    'OrganizationViewSet',
    'ProductSearchAPIView',
    'PurchaseOrderViewSet',
    'RSGeLookupAPIView',
    'ReverseGeocodeAPIView',
    'SearchAddressesAPIView',
    'WarehouseViewSet',
]
