"""Remote client lookup and creation.

Clients live in the per-org 1C service rather than locally, so every view
here is a proxy: RS.ge taxpayer lookup, CheckClient/CreateClient, and the
Photon-backed address helpers.
"""

import logging

import httpx
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
    _extract_client_list,
    _normalize_client_response,
)
from core.services.photon import PhotonError, reverse_geocode, search_addresses
from core.views.common import _consult_error_response


@extend_schema(tags=['Clients'])
class RSGeLookupAPIView(APIView):
    """Look up a taxpayer's name from RS.ge by identification number."""
    permission_classes = []
    serializer_class = RSGeLookupSerializer
    http_method_names = ["post"]

    RS_GE_API_URL = "https://xdata.rs.ge/TaxPayer/RSPublicInfo"

    def post(self, request: Request) -> Response:
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        identification_number = serializer.validated_data['identification_number'].strip()

        try:
            rs_response = httpx.post(
                self.RS_GE_API_URL,
                json={"IdentCode": identification_number},
                headers={"Accept": "application/json"},
                timeout=10.0,
            )
        except httpx.TimeoutException:
            logging.error(f"RS.ge lookup timeout for ID {identification_number}")
            return Response(
                {"code": "RS_GE_TIMEOUT", "detail": "Timeout while connecting to RS.ge."},
                status=http_status.HTTP_504_GATEWAY_TIMEOUT,
            )
        except httpx.RequestError as e:
            logging.error(f"RS.ge lookup error for ID {identification_number}: {e}")
            return Response(
                {"code": "RS_GE_ERROR", "detail": "Could not connect to RS.ge."},
                status=http_status.HTTP_502_BAD_GATEWAY,
            )

        if rs_response.status_code != 200:
            logging.warning(
                f"RS.ge returned {rs_response.status_code} for ID {identification_number}"
            )
            return Response(
                {"code": "RS_GE_NOT_FOUND", "detail": "Taxpayer not found on RS.ge."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        try:
            data = rs_response.json()
        except Exception:
            return Response(
                {"code": "RS_GE_PARSE_ERROR", "detail": "Could not parse RS.ge response."},
                status=http_status.HTTP_502_BAD_GATEWAY,
            )

        # RS.ge returns a list of results or a paginated structure
        # Try to extract the taxpayer info from the response
        taxpayer = None
        if isinstance(data, list) and len(data) > 0:
            taxpayer = data[0]
        elif isinstance(data, dict):
            # Could be paginated: { results: [...], ... } or direct object
            results = data.get('data') or data.get('results') or data.get('items')
            if isinstance(results, list) and len(results) > 0:
                taxpayer = results[0]
            elif 'name' in data or 'first_name' in data or 'taxpayer_name' in data:
                taxpayer = data

        if not taxpayer:
            return Response(
                {"code": "RS_GE_NOT_FOUND", "detail": "Taxpayer not found on RS.ge."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        # Unknown IDs still come back as 200 with a record whose fields are
        # all null, so a null/blank FullName means "not found"
        full_name = (taxpayer.get('FullName') or '').strip()
        if not full_name:
            return Response(
                {"code": "RS_GE_NOT_FOUND", "detail": "Taxpayer not found on RS.ge."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        parts = full_name.split(None, 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else ""

        return Response({
            "identification_number": identification_number,
            "first_name": first_name,
            "last_name": last_name,
            "raw": taxpayer,
        })


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
            return _consult_error_response(exc)

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
            return _consult_error_response(exc)

        # CreateClient returns a single newly-created client; pull the first
        # entry out of whatever wrapper shape upstream used.
        items = _extract_client_list(result)
        normalized = _normalize_client_response(items[0]) if items else {"raw": result}
        return Response(
            CheckClientResponseSerializer(normalized).data,
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
            body: dict = {"code": exc.code, "detail": exc.detail}
            if exc.upstream_status is not None:
                body["external_service_status_code"] = exc.upstream_status
            return Response(body, status=exc.http_status)

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
            body: dict = {"code": exc.code, "detail": exc.detail}
            if exc.upstream_status is not None:
                body["external_service_status_code"] = exc.upstream_status
            return Response(body, status=exc.http_status)

        cache.set(cache_key, suggestions, self.CACHE_TTL_SECONDS)
        return Response({"suggestions": suggestions})
