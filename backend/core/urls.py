from django.urls import path, include
from rest_framework.routers import DefaultRouter

from core.views import (
    OrganizationViewSet,
    WarehouseViewSet,
    ProductSearchAPIView,
    CustomerViewSet,
    PurchaseOrderViewSet,
)

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'warehouses', WarehouseViewSet, basename='warehouse')
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'orders', PurchaseOrderViewSet, basename='order')

urlpatterns = [
    path('', include(router.urls)),
    path('product/search/', ProductSearchAPIView.as_view(), name='product-search'),
]
