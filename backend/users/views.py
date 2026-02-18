from django.shortcuts import render
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from backend.users.serializers import ClientIPSerializer



class GetClientIPAPIView:
    serializer_class = ClientIPSerializer

    def get(self, request: Request) -> Response:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff and "," in xff:
            ip = xff.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR")

        serializer = self.serializer_class({"ip": ip})
        return Response(serializer.data)

