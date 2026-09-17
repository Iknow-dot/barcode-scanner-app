import {ADD_FLOW_IDLE, lookupClosed, orderStartFailed, orderStarted, startAdd} from './addFlow';

const ITEM = {quantity: 2, warehouse_code: 'W1', warehouse_name: 'Vake', price: '89.90'};

describe('addFlow', () => {
    it('adds at once when an order is active', () => {
        expect(startAdd(ADD_FLOW_IDLE, ITEM, true)).toEqual({
            flow: ADD_FLOW_IDLE,
            effect: {type: 'add', item: ITEM},
        });
    });

    it('holds the pick and opens the client lookup when no order is active', () => {
        expect(startAdd(ADD_FLOW_IDLE, ITEM, false)).toEqual({
            flow: {pending: ITEM},
            effect: {type: 'lookup-client'},
        });
    });

    it('adds the held pick once the order exists', () => {
        const {flow} = startAdd(ADD_FLOW_IDLE, ITEM, false);
        expect(orderStarted(flow)).toEqual({flow: ADD_FLOW_IDLE, effect: {type: 'add', item: ITEM}});
    });

    it('adds nothing for an order started without a held pick', () => {
        expect(orderStarted(ADD_FLOW_IDLE)).toEqual({flow: ADD_FLOW_IDLE, effect: null});
    });

    it('drops the held pick when the lookup is closed', () => {
        const {flow} = startAdd(ADD_FLOW_IDLE, ITEM, false);
        const closed = lookupClosed(flow);
        expect(closed).toEqual({flow: ADD_FLOW_IDLE, effect: null});
        expect(orderStarted(closed.flow).effect).toBeNull();
    });

    it('drops the held pick when the order cannot be created', () => {
        const {flow} = startAdd(ADD_FLOW_IDLE, ITEM, false);
        const failed = orderStartFailed(flow);
        expect(failed).toEqual({flow: ADD_FLOW_IDLE, effect: null});
        expect(orderStarted(failed.flow).effect).toBeNull();
    });
});
