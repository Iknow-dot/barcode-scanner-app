import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Look up a client in the org's 1C ConsultWebExchange service.
 *
 * Provide identification_number, phone or name — backend requires at least
 * one, and upstream matches all three against the same field, so an exact
 * identifier wins over a name when both are sent. Returns success=true with
 * the matched clients on a hit; on a miss returns success=false with
 * code === 'CLIENT_NOT_FOUND' (HTTP 404). Other codes (EXTERNAL_SERVICE_*)
 * indicate transport / auth / upstream failures.
 *
 * @param {object} payload - { identification_number?, phone?, name? }
 */
export const checkClient = ({ identification_number, phone, name } = {}) => {
    return api.post(API_ENDPOINTS.client_check, {
        identification_number: identification_number || '',
        phone: phone || '',
        name: name || '',
    });
};

/**
 * Create a client in the org's 1C ConsultWebExchange service.
 *
 * @param {object} payload - { first_name, last_name, identification_number?, is_phys?, phone?, phone_2?, email?, address_line? }
 */
export const createClient = (payload) => {
    return api.post(API_ENDPOINTS.client_create, payload);
};

/**
 * Look up a Georgian taxpayer's name from RS.ge by identification number.
 * Used to autofill first/last name before CreateClient.
 *
 * @param {string} identificationNumber
 */
export const lookupRsGe = (identificationNumber) => {
    return api.post(API_ENDPOINTS.rs_ge_lookup, {
        identification_number: identificationNumber,
    });
};

/**
 * Reverse-geocode a lat/lng pair (from the Leaflet map picker) to a
 * formatted address string via the backend's Nominatim proxy.
 *
 * @param {{lat: number, lng: number}} payload
 */
export const reverseGeocode = ({lat, lng}) => {
    return api.post(API_ENDPOINTS.client_reverse_geocode, {lat, lng});
};

/**
 * Forward-geocode a typed address fragment into a list of suggestions
 * via the backend's Nominatim proxy. Drives the address autocomplete on
 * the new-client form. Backend short-circuits queries shorter than 3
 * characters with an empty list.
 *
 * @param {string} query
 * @param {{limit?: number}} [opts]
 */
export const searchAddresses = (query, {limit} = {}) => {
    return api.post(API_ENDPOINTS.client_search_addresses, {
        q: query,
        ...(limit ? {limit} : {}),
    });
};
