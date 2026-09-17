import displayCustomerName from '../../utils/orderDisplay';

/**
 * View state for the active-order bar that floats above the tab bar.
 *
 * With an active order it shows the item-count badge, the client and the
 * running total, and tapping it opens the order drawer (active: true).
 * Without one it stays idle but not disabled — "cart · empty", no badge
 * (iOS hides zero badges) — and tapping it starts an order (active: false).
 */
const activeOrderBarView = (activeOrder, t) => {
    if (!activeOrder) {
        return {active: false, badgeCount: 0, title: t.cart, subtitle: t.cartEmpty};
    }
    const badgeCount = Array.isArray(activeOrder.items) ? activeOrder.items.length : 0;
    const title = displayCustomerName(activeOrder, t) || `#${activeOrder.id}`;
    const subtitle = activeOrder.total != null
        ? `${t.activeOrder} · ${activeOrder.total} ₾`
        : t.activeOrder;
    return {active: true, badgeCount, title, subtitle};
};

export default activeOrderBarView;
