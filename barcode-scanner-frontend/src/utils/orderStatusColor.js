// antd Tag preset for each order status, shared by the consultant and admin
// order lists. No status is green: green is the app's accent (theme/tokens.css),
// and every tag also shows the status word, so colour is never the only cue.
export const ORDER_STATUS_COLOR = {
    draft: 'default',
    confirmed: 'blue',
    completed: 'cyan',
    cancelled: 'red',
};

export const orderStatusColor = (status) => ORDER_STATUS_COLOR[status] || 'default';
