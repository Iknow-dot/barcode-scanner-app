import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Per-consultant order analytics for a period.
 * @param {object} [params] - { date_from, date_to, organization }
 */
export const getOrderAnalytics = (params) => {
    return api.get(API_ENDPOINTS.analytics_orders, { params });
};
