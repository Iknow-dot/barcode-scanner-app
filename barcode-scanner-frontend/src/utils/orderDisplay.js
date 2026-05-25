// Resolves the customer label to show for an order. Retail (clientless) orders
// have a blank customer_name and is_retail=true; show the localized retail
// label instead. Everything else shows the stored customer_name.
const displayCustomerName = (order, t) => {
    if (order && order.is_retail) {
        return t.retailCustomerLabel;
    }
    return (order && order.customer_name) || '';
};

export default displayCustomerName;
