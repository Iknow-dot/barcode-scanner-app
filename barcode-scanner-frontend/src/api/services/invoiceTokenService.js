import client from '../client';
import endpoints from '../endpoints';

const invoiceTokenService = {
  async fetchCatalogAndDefault() {
    try {
      const response = await client.get(endpoints.invoice_tokens);
      return {success: true, data: response.data};
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  },

  async fetchSampleValues({orderId} = {}) {
    try {
      const params = orderId ? {order_id: orderId} : {};
      const response = await client.get(endpoints.invoice_token_sample_values, {params});
      return {success: true, data: response.data};
    } catch (error) {
      return {success: false, error: error.response?.data?.detail || error.message};
    }
  },
};

export default invoiceTokenService;
