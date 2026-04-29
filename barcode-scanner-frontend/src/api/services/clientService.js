import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Look up a client in the org's 1C ConsultWebExchange service.
 *
 * Provide identification_number, phone, or both — backend requires at least
 * one. Returns success=true with the normalized client on a hit; on a miss
 * returns success=false with code === 'CLIENT_NOT_FOUND' (HTTP 404). Other
 * codes (EXTERNAL_SERVICE_*) indicate transport / auth / upstream failures.
 *
 * @param {object} payload - { identification_number?, phone? }
 */
export const checkClient = ({ identification_number, phone } = {}) => {
    return api.post(API_ENDPOINTS.client_check, {
        identification_number: identification_number || '',
        phone: phone || '',
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
