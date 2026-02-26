from django.urls import path, include
from rest_framework.routers import DefaultRouter

from core.views import OrganizationViewSet, WarehouseViewSet, ProductSearchAPIView

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'warehouses', WarehouseViewSet, basename='warehouse')

urlpatterns = [
    path('', include(router.urls)),
    path('product/search/', ProductSearchAPIView.as_view(), name='product-search'),
]
