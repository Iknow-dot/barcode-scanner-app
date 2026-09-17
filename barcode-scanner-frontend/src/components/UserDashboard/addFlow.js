/**
 * "Add to order" from the product sheet, as a tiny state machine.
 *
 * With an active order the pick is added at once. Without one, the pick is
 * held while the new-order client lookup is open: creating (or resuming) an
 * order adds it, and closing the lookup or failing to create the order drops
 * it — the product sheet stays open, nothing is added.
 *
 * Each step returns the next flow and the effect the dashboard must run:
 * {type: 'add', item} or {type: 'lookup-client'}, or null for none.
 */
export const ADD_FLOW_IDLE = Object.freeze({pending: null});

// If a pick is already held, starting another replaces it — last pick wins,
// with no drop effect for the one it replaces. This is safe because the
// lookup is modal over the product sheet: the only way to reach a second
// startAdd while `flow.pending` is set is through the same held pick's own
// lookup, and closing that lookup (lookupClosed) already drops it first.
export const startAdd = (flow, item, hasActiveOrder) => (
    hasActiveOrder
        ? {flow: ADD_FLOW_IDLE, effect: {type: 'add', item}}
        : {flow: {pending: item}, effect: {type: 'lookup-client'}}
);

export const lookupClosed = () => ({flow: ADD_FLOW_IDLE, effect: null});

export const orderStarted = (flow) => (
    flow && flow.pending
        ? {flow: ADD_FLOW_IDLE, effect: {type: 'add', item: flow.pending}}
        : {flow: ADD_FLOW_IDLE, effect: null}
);

export const orderStartFailed = () => ({flow: ADD_FLOW_IDLE, effect: null});
