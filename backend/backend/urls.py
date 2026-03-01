from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(['GET', 'POST', 'PUT', 'DELETE'])
def test_code(request):
    message = request.GET.get('message')
    try:
        code = int(request.GET.get('code', '200'))
    except ValueError:
        code = 400

    return Response({'message': message}, status=code)

urlpatterns = [
    path('admin/', admin.site.urls),

    # App routes
    path('api/v1/', include('core.urls')),
    path('api/v1/users/', include('users.urls')),

    # Swagger / OpenAPI
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    path("test/code")
]
