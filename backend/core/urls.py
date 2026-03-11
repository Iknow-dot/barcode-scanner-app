from django.urls import path, include
from rest_framework.routers import DefaultRouter

from core.views import (
    OrganizationViewSet,
    WarehouseViewSet,
    ProductSearchAPIView,
    CustomerViewSet,
    PurchaseOrderViewSet,
    RSGeLookupAPIView,
)

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'warehouses', WarehouseViewSet, basename='warehouse')
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'orders', PurchaseOrderViewSet, basename='order')

urlpatterns = [
    path('customers/rs-ge-lookup/', RSGeLookupAPIView.as_view(), name='rs-ge-lookup'),
    path('product/search/', ProductSearchAPIView.as_view(), name='product-search'),
    path('', include(router.urls)),
]
