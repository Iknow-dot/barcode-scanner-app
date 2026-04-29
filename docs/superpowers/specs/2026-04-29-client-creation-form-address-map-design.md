# Client creation form + address map picker

**Date:** 2026-04-29
**Owner:** tavkhelidzeluka@gmail.com
**Status:** Approved — ready for implementation plan

## Goal

When `CheckClient` returns `CLIENT_NOT_FOUND`, the frontend already pivots to a creation form. Realign that form with the 1C ConsultWebExchange `CreateClient` field set, and replace the country/city/district selectors with a Leaflet map that picks an address. Lat/lng are not sent upstream — only the formatted address string.

## Field set

The new create-step form fields, in order:

| Internal name (frontend / serializer) | UI control | Required | 1C field |
|---|---|---|---|
| `identification_number` | Text + RS.ge lookup button | optional | `personal_number` |
| `is_phys` | Segmented control: Physical / Legal | required, default Physical (`true`) | `IsPhys` |
| `first_name` | Text | required | `first_name` |
| `last_name` | Text | required | `last_name` |
| `phone` | Text | optional | `phone_1` |
| `phone_2` | Text | optional | `phone_2` |
| `email` | Text (email validator) | optional | `Email` |
| `address_line` | Text + inline Leaflet map | optional | `address_line` (top-level, NOT nested) |

Removed from the form and from the request serializer: `country`, `city`, `district`. The `geoData.js` import in `ClientLookupModal.js` and the `selectedCountry` / `selectedCity` / `cityOptions` / `districtOptions` hooks go away with them.

Internal field names remain Django-snake-case (`identification_number`, `phone`, `is_phys`, `address_line`) — the service layer maps them to 1C names.

## Address map picker

New component `AddressMapPicker` colocated with `ClientLookupModal.js` in `barcode-scanner-frontend/src/components/UserDashboard/`.

**Behavior:**
- Renders a `react-leaflet` `MapContainer` with an OSM `TileLayer` and a single draggable `Marker`. ~250 px tall, sits directly under the address text input.
- Default view on every open: Tbilisi center (lat `41.7151`, lng `44.8271`), zoom `12`. No persistence between opens.
- Click anywhere on the map → marker jumps there → triggers reverse geocode → fills the `address_line` text field.
- Drag the marker → same auto-fill behavior.
- A `useMapEvents` hook handles map clicks; the marker's `eventHandlers.dragend` handles drag.
- During the geocode call, the address input shows a small spinner suffix (Ant Design `LoadingOutlined`).
- The address text remains editable after auto-fill — user can type freely without the map updating.
- Lat/lng is held in component state only; **not** persisted, **not** sent to backend `CreateClient`, **not** stored on `PurchaseOrder`.

**Props:**
```
{
  value: string,           // address_line text
  onChange: (string) => void,
  disabled?: boolean,
}
```

The map sits beside the input and shares the same change channel — when the geocoder returns text, it calls `onChange(address)`.

## Backend reverse-geocode endpoint

**Route:** `POST /api/v1/clients/reverse-geocode/`
**View:** `ReverseGeocodeAPIView` in `core/views.py`
**Permission:** `IsAuthenticated` (consistent with `/clients/check/` and `/clients/create/`).
**Request body:** `{ "lat": float, "lng": float }` — DRF-validated, lat ∈ [-90, 90], lng ∈ [-180, 180].
**Success response:** `{ "success": true, "address": "..." }`.
**Error response:** `{ "success": false, "code": "EXTERNAL_SERVICE_*", "detail": "..." }`, mirroring the existing error envelope used by `/clients/check/` etc.

**Upstream call:**
- `GET https://nominatim.openstreetmap.org/reverse?format=json&lat=…&lon=…&accept-language=ka,en`
- Required `User-Agent` header — populated from a new Django setting `NOMINATIM_USER_AGENT`, sourced from env (e.g. `BarcodeScannerApp/1.0 (admin@example.com)`).
- `httpx.get` with the existing 15 s timeout convention used in `consult_web_exchange.py`.

**Address extraction:** Use `display_name` from the Nominatim JSON response (the human-readable formatted string).

**Caching:** Django's default cache, key `nominatim:rev:{round(lat, 4)}:{round(lng, 4)}`, TTL 24 h. Two clicks within ~10 m get one upstream call.

**Error mapping:**
- `httpx.TimeoutException` → `EXTERNAL_SERVICE_TIMEOUT`, HTTP 504.
- `httpx.ConnectError` → `EXTERNAL_SERVICE_UNAVAILABLE`, HTTP 502.
- Other `httpx.RequestError` → `EXTERNAL_SERVICE_ERROR`, HTTP 502.
- Non-200 upstream → `EXTERNAL_SERVICE_ERROR`, HTTP 502.
- Nominatim returning `{ "error": "Unable to geocode" }` → `{success: false, code: "REVERSE_GEOCODE_NOT_FOUND", detail: "..."}`, HTTP 404.

The Nominatim call lives in `core/services/nominatim.py` (a separate small module; not added to `consult_web_exchange.py`, since it's a different upstream).

**Spectacular tag:** existing `clients` tag.

## Backend create-client changes

**`core/serializers.py` — `CreateClientRequestSerializer`:**
- Add `is_phys = serializers.BooleanField(required=False, default=True)`.
- Rename `address` → `address_line`.
- Remove `country`, `city`, `district` fields and their docstring blurb.

**`core/services/consult_web_exchange.py` — `create_client`:**
- Add `IsPhys` to upstream payload, mapped from `payload["is_phys"]`. Always included (Boolean default from serializer means it's always present).
- Flatten address: when `payload.get("address_line")` is non-empty, set `upstream["address_line"] = payload["address_line"]` at top level.
- Drop city_id / district_id branches and the nested `address` object.
- Update the file-header comment block to reflect the new payload shape (`IsPhys` flag, flat `address_line`).

## Frontend service updates

**`barcode-scanner-frontend/src/api/services/clientService.js`:**
- Update `createClient` JSDoc to: `{ first_name, last_name, identification_number?, is_phys?, phone?, phone_2?, email?, address_line? }`.
- Add `reverseGeocode({ lat, lng })` posting to the new endpoint.

**`barcode-scanner-frontend/src/api/endpoints.js`:**
- Add `client_reverse_geocode: '/clients/reverse-geocode/'`.

## Translations (`barcode-scanner-frontend/src/i18n/translations.js`)

Add to both `ka` and `en` blocks:
- `isPhys` — section/control label ("ფიზიკური/იურიდიული პირი" / "Person Type").
- `physicalPerson` — segmented option ("ფიზიკური პირი" / "Physical person").
- `legalEntity` — segmented option ("იურიდიული პირი" / "Legal entity").
- `secondaryPhone` — phone_2 label ("დამატებითი ტელეფონი" / "Secondary phone").
- `clickMapToPickAddress` — map placeholder/help ("დააჭირეთ რუკას მისამართის ასარჩევად" / "Click the map to pick an address").
- `reverseGeocodeError` — generic failure toast ("მისამართის ამოცნობა ვერ მოხერხდა" / "Could not resolve the address from the map").

`country` / `city` / `district` keys stay for now — grep first; if no other consumer references them they can be deleted in a follow-up, but keeping them is safe.

## Validation rules

- `first_name`, `last_name` remain required at both serializer and form level.
- Lookup step still requires `identification_number` OR `phone` (already enforced).
- `is_phys` always present (default `true` from serializer).
- `address_line` ≤ 500 characters (matches current `address` field).

## Tests

**Backend (`core/tests.py`):**
- Extend the existing `consult_web_exchange` create-client tests to assert the upstream payload includes `IsPhys` (true and false cases) and a top-level `address_line` rather than a nested `address` object.
- New tests for `ReverseGeocodeAPIView`:
  - Happy path: mocked Nominatim returns `{ "display_name": "..." }` → `{success: true, address: "..."}`.
  - Validation: out-of-range lat/lng → 400.
  - Timeout: `httpx.TimeoutException` → 504, `EXTERNAL_SERVICE_TIMEOUT`.
  - Connect error: `httpx.ConnectError` → 502, `EXTERNAL_SERVICE_UNAVAILABLE`.
  - Nominatim "error" field → 404, `REVERSE_GEOCODE_NOT_FOUND`.
  - Auth: anonymous request → 401.

**Frontend:** existing CRA test setup; manual check via `npm start` after wiring the map.

## New dependencies

**Frontend (`barcode-scanner-frontend/package.json`):**
- `leaflet@^1.9.4`
- `react-leaflet@^4.2.1` (CRA + React 18 compatible)

Add `import 'leaflet/dist/leaflet.css';` once at app entry. Standard Leaflet marker-icon URL workaround applies (the bundler doesn't resolve the default icon paths — we point them at the leaflet package's icon files explicitly inside `AddressMapPicker`).

**Backend:** none — `httpx` and Django's cache framework are already in use.

## Out of scope

- Storing the picked lat/lng on `PurchaseOrder` or anywhere else.
- Forward geocoding (typing an address to move the pin).
- Address autocomplete / Nominatim search suggestions.
- Self-hosting Nominatim. Public Nominatim with backend-side proxying + caching is sufficient for our volume.
- Reusing the picker outside this modal. If needed later, the component is already self-contained.
- Migrating existing `country` / `city` / `district` translation keys out of `translations.js`.

## Risks / open items

- **Nominatim usage policy.** The free public instance has a 1 req/sec policy. Backend caching (24 h TTL on coarse 4-decimal coordinates) keeps us safely below this. If volume grows we revisit.
- **Leaflet default-marker icon bug under webpack.** Known CRA issue; handled in the component by overriding `L.Icon.Default.prototype._getIconUrl` and pointing to the package's image files.
- **`address_line` flat vs nested.** We're switching from nested `address.address_line` to top-level `address_line`. If 1C still requires the nested shape, the tests against a real instance will catch it; the fix is a one-line change in `consult_web_exchange.create_client`.
