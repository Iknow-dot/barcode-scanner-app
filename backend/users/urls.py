from django.urls import path

from users.views import GetClientIPAPIView

urlpatterns = [
    path('client-ip/', GetClientIPAPIView.as_view(), name='client-ip'),
]
