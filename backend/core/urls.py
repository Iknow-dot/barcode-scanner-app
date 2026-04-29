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
)

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'warehouses', WarehouseViewSet, basename='warehouse')
router.register(r'orders', PurchaseOrderViewSet, basename='order')

urlpatterns = [
    path('clients/check/', CheckClientAPIView.as_view(), name='client-check'),
    path('clients/create/', CreateClientAPIView.as_view(), name='client-create'),
    path('clients/rs-ge-lookup/', RSGeLookupAPIView.as_view(), name='rs-ge-lookup'),
    path('clients/reverse-geocode/', ReverseGeocodeAPIView.as_view(), name='client-reverse-geocode'),
    path('product/search/', ProductSearchAPIView.as_view(), name='product-search'),
    path('', include(router.urls)),
]
