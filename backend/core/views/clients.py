"""Remote client lookup and creation.

Clients live in the per-org 1C service rather than locally, so every view
here is a proxy: RS.ge taxpayer lookup, CheckClient/CreateClient, and the
Photon-backed address helpers.
"""

from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework import status as http_status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsCompanyUserOrAdmin
from core.serializers import (
    RSGeLookupSerializer,
    CheckClientRequestSerializer,
    CheckClientResponseSerializer,
    CreateClientRequestSerializer,
    ReverseGeocodeRequestSerializer,
    SearchAddressesRequestSerializer,
)
from core.services.consult_web_exchange import (
    ConsultWebExchangeClient,
    ConsultWebExchangeError,
)
from core.services.photon import PhotonError, reverse_geocode, search_addresses
from core.services.rs_ge import RSGeError, lookup_taxpayer
from core.views.common import external_error_response


@extend_schema(tags=['Clients'])
class RSGeLookupAPIView(APIView):
    """Look up a taxpayer's name from RS.ge by identification number."""
    permission_classes = []
    serializer_class = RSGeLookupSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        identification_number = serializer.validated_data['identification_number'].strip()
        try:
            return Response(lookup_taxpayer(identification_number))
        except RSGeError as exc:
            return external_error_response(exc)


# ---------------------------------------------------------------------------
# Client lookup / creation (1C ConsultWebExchange)
# ---------------------------------------------------------------------------

@extend_schema(tags=['Clients'])
class CheckClientAPIView(APIView):
    """Look up a client in the org's 1C ConsultWebExchange service."""

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = CheckClientRequestSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        client = ConsultWebExchangeClient(request.user.organization)
        try:
            result = client.check_client(
                identification_number=data.get('identification_number') or None,
                phone=data.get('phone') or None,
            )
        except ConsultWebExchangeError as exc:
            return external_error_response(exc)

        if not result:
            return Response(
                {"code": "CLIENT_NOT_FOUND", "detail": "Client not found in the organization's web service."},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        return Response({
            "clients": [CheckClientResponseSerializer(client).data for client in result],
        })


@extend_schema(tags=['Clients'])
class CreateClientAPIView(APIView):
    """Create a client in the org's 1C ConsultWebExchange service."""

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = CreateClientRequestSerializer
    http_method_names = ["post"]

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)

        client = ConsultWebExchangeClient(request.user.organization)
        try:
            result = client.create_client(serializer.validated_data)
        except ConsultWebExchangeError as exc:
            return external_error_response(exc)

        return Response(
            CheckClientResponseSerializer(result).data,
            status=http_status.HTTP_201_CREATED,
        )


@extend_schema(tags=['Clients'])
class ReverseGeocodeAPIView(APIView):
    """Reverse-geocode a lat/lng to a formatted address via Photon.

    Used by the frontend address-map picker. Results are cached for 24 h
    keyed at 4-decimal precision (~10 m).
    """

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = ReverseGeocodeRequestSerializer
    http_method_names = ["post"]

    CACHE_TTL_SECONDS = 60 * 60 * 24
    CACHE_PRECISION = 4

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        lat = serializer.validated_data["lat"]
        lng = serializer.validated_data["lng"]

        cache_key = (
            f"photon:rev:{round(lat, self.CACHE_PRECISION)}:"
            f"{round(lng, self.CACHE_PRECISION)}"
        )
        cached = cache.get(cache_key)
        if cached is not None:
            return Response({"address": cached})

        try:
            address = reverse_geocode(lat, lng)
        except PhotonError as exc:
            return external_error_response(exc)

        cache.set(cache_key, address, self.CACHE_TTL_SECONDS)
        return Response({"address": address})


@extend_schema(tags=['Clients'])
class SearchAddressesAPIView(APIView):
    """Forward-geocode a free-text query into a list of address suggestions.

    Drives the address autocomplete on the new-client form. Results are
    cached for 6 h keyed by lower-cased query + limit so repeated typing
    of the same prefix doesn't burn the upstream quota. Backed by Photon
    rather than Nominatim (Nominatim's public /search rejects typeahead
    traffic with 403).
    """

    permission_classes = [IsCompanyUserOrAdmin]
    serializer_class = SearchAddressesRequestSerializer
    http_method_names = ["post"]

    CACHE_TTL_SECONDS = 60 * 60 * 6
    MIN_QUERY_LENGTH = 3

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        query = serializer.validated_data["q"].strip()
        limit = serializer.validated_data.get("limit", 8)

        if len(query) < self.MIN_QUERY_LENGTH:
            return Response({"suggestions": []})

        cache_key = f"photon:search:{query.lower()}:{limit}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response({"suggestions": cached})

        try:
            suggestions = search_addresses(query, limit=limit)
        except PhotonError as exc:
            return external_error_response(exc)

        cache.set(cache_key, suggestions, self.CACHE_TTL_SECONDS)
        return Response({"suggestions": suggestions})
