from __future__ import annotations

import httpx

from core.models import Organization
from cryptography.fernet import Fernet
from unittest import mock


_TEST_FERNET_KEY = Fernet.generate_key().decode()


def _make_organization(**overrides) -> Organization:
    defaults = dict(
        name=overrides.pop('name', 'TestOrg'),
        identification_number=overrides.pop('identification_number', '123456789'),
        web_service_url=overrides.pop('web_service_url', 'http://example.com/db'),
        web_service_username=overrides.pop('web_service_username', 'svc-user'),
        employees_count=overrides.pop('employees_count', 5),
    )
    defaults.update(overrides)
    return Organization.objects.create(**defaults)


def _mock_httpx_response(status_code: int, body: object = None, json_raises: bool = False):
    resp = mock.Mock(spec=httpx.Response)
    resp.status_code = status_code
    if json_raises:
        resp.json.side_effect = ValueError('not json')
    else:
        resp.json.return_value = body if body is not None else {}
    return resp


def _photon_feature(coordinates=(0.0, 0.0), **props) -> dict:
    return {
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': list(coordinates)},
        'properties': props,
    }


def _photon_collection(*features) -> dict:
    return {'type': 'FeatureCollection', 'features': list(features)}


def _rs_ge_record(**overrides) -> list:
    """One-element list as returned by RS.ge RSPublicInfo. For unknown IDs the
    API still returns 200 with a record whose fields are all null."""
    record = {
        'Status': None,
        'RegisteredSubject': None,
        'FullName': None,
        'StartDate': None,
        'VatPayer': None,
        'Mortgage': None,
        'Sequestration': None,
        'AdditionalStatus': None,
        'NonResident': 'არა',
    }
    record.update(overrides)
    return [record]
