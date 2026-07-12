from django.urls import path, include
from rest_framework.routers import DefaultRouter

from core.views import (
    OrganizationViewSet,
    WarehouseViewSet,
    ProductSearchAPIView,
    PurchaseOrderViewSet,
    RSGeLookupAPIView,
    CheckClientAPIView,
    CreateClientAPIView,
    ReverseGeocodeAPIView,
    SearchAddressesAPIView,
    InvoiceTokensAPIView,
    InvoiceSampleValuesAPIView,
    OrderAnalyticsAPIView,
    CatalogProductIngestAPIView,
    CatalogProductDeactivateAPIView,
    CatalogProductSearchAPIView,
    CatalogProductImageAPIView,
)

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'warehouses', WarehouseViewSet, basename='warehouse')
router.register(r'orders', PurchaseOrderViewSet, basename='order')

urlpatterns = [
    path('invoice-tokens/', InvoiceTokensAPIView.as_view(), name='invoice-tokens'),
    path('invoice-tokens/sample-values/', InvoiceSampleValuesAPIView.as_view(), name='invoice-token-sample-values'),
    path('clients/check/', CheckClientAPIView.as_view(), name='client-check'),
    path('clients/create/', CreateClientAPIView.as_view(), name='client-create'),
    path('clients/rs-ge-lookup/', RSGeLookupAPIView.as_view(), name='rs-ge-lookup'),
    path('clients/reverse-geocode/', ReverseGeocodeAPIView.as_view(), name='client-reverse-geocode'),
    path('clients/search-addresses/', SearchAddressesAPIView.as_view(), name='client-search-addresses'),
    path('product/search/', ProductSearchAPIView.as_view(), name='product-search'),
    path('analytics/orders/', OrderAnalyticsAPIView.as_view(), name='order-analytics'),
    path('catalog/products/deactivate/', CatalogProductDeactivateAPIView.as_view(), name='catalog-product-deactivate'),
    path('catalog/products/search/', CatalogProductSearchAPIView.as_view(), name='catalog-product-search'),
    path('catalog/products/<str:sku>/image/<int:idx>/', CatalogProductImageAPIView.as_view(), name='catalog-product-image'),
    path('catalog/products/', CatalogProductIngestAPIView.as_view(), name='catalog-product-ingest'),
    path('', include(router.urls)),
]
