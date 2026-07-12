from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from core.schema import INTEGRATION_DESCRIPTION

urlpatterns = [
    path('admin/', admin.site.urls),

    # App routes
    path('api/v1/', include('core.urls')),
    path('api/v1/users/', include('users.urls')),

    # Swagger / OpenAPI — full internal API (JWT), consumed by our own frontend
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    # Catalog Integration API — the focused contract external systems (1C) push into.
    # Same SpectacularAPIView, filtered to the ingest endpoints via a preprocessing hook.
    path(
        'api/integration/schema/',
        SpectacularAPIView.as_view(
            custom_settings={
                'TITLE': 'Barcode Scanner — Catalog Integration API',
                'DESCRIPTION': INTEGRATION_DESCRIPTION,
                'VERSION': '1.0.0',
                'PREPROCESSING_HOOKS': ['core.schema.integration_endpoints_only'],
                # Scope the tag list so ReDoc doesn't render the internal API's tag
                # groups (Users, Organizations, …) as empty nav sections.
                'TAGS': [{'name': 'Catalog Ingest', 'description': 'Push your product catalog into the platform. · კატალოგის ატვირთვა პლატფორმაზე.'}],
            },
        ),
        name='integration-schema',
    ),
    path('api/integration/redoc/', SpectacularRedocView.as_view(url_name='integration-schema'), name='integration-redoc'),
]
