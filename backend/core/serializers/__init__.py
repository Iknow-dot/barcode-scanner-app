"""Core API serializers.

Split by resource, mirroring ``core/views/``. This module re-exports every
serializer so ``from core.serializers import X`` keeps working for the view
modules and for ``users/serializers.py``.
"""

from core.serializers.analytics import ConsultantOrderStatsSerializer
from core.serializers.catalog_ingest import (
    CatalogDeactivateRequestSerializer,
    CatalogDeactivateResponseSerializer,
    CatalogIngestCategoryNodeSerializer,
    CatalogIngestProductSerializer,
    CatalogIngestRequestSerializer,
    CatalogIngestResponseSerializer,
    OrderCompleteRequestSerializer,
    OrderCompleteResponseSerializer,
)
from core.serializers.catalog_read import (
    CatalogAdminProductSerializer,
    CatalogCategoryNodeSerializer,
    CatalogProductSerializer,
    CatalogSyncStatusSerializer,
)
from core.serializers.clients import (
    CheckClientRequestSerializer,
    CheckClientResponseSerializer,
    CreateClientRequestSerializer,
    RSGeLookupSerializer,
    ReverseGeocodeRequestSerializer,
    SearchAddressesRequestSerializer,
)
from core.serializers.orders import (
    AddOrderItemSerializer,
    BulkUpdateOrderItemsDataSerializer,
    BulkUpdateOrderItemsSerializer,
    PurchaseOrderItemSerializer,
    PurchaseOrderListSerializer,
    PurchaseOrderSerializer,
)
from core.serializers.organizations import (
    OrganizationExternalServiceSerializer,
    OrganizationInvoiceTemplateSerializer,
    OrganizationSecuritySerializer,
    OrganizationSerializer,
)
from core.serializers.products import ProductSearchSerializer
from core.serializers.warehouses import (
    WarehouseReadOnlySerializer,
    WarehouseSerializer,
)

__all__ = [
    'AddOrderItemSerializer',
    'BulkUpdateOrderItemsDataSerializer',
    'BulkUpdateOrderItemsSerializer',
    'CatalogAdminProductSerializer',
    'CatalogCategoryNodeSerializer',
    'CatalogDeactivateRequestSerializer',
    'CatalogDeactivateResponseSerializer',
    'CatalogIngestCategoryNodeSerializer',
    'CatalogIngestProductSerializer',
    'CatalogIngestRequestSerializer',
    'CatalogIngestResponseSerializer',
    'CatalogProductSerializer',
    'CatalogSyncStatusSerializer',
    'CheckClientRequestSerializer',
    'CheckClientResponseSerializer',
    'ConsultantOrderStatsSerializer',
    'CreateClientRequestSerializer',
    'OrderCompleteRequestSerializer',
    'OrderCompleteResponseSerializer',
    'OrganizationExternalServiceSerializer',
    'OrganizationInvoiceTemplateSerializer',
    'OrganizationSecuritySerializer',
    'OrganizationSerializer',
    'ProductSearchSerializer',
    'PurchaseOrderItemSerializer',
    'PurchaseOrderListSerializer',
    'PurchaseOrderSerializer',
    'RSGeLookupSerializer',
    'ReverseGeocodeRequestSerializer',
    'SearchAddressesRequestSerializer',
    'WarehouseReadOnlySerializer',
    'WarehouseSerializer',
]
