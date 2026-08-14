/**
 * View state for the floating dock's cart slot.
 *
 * With an active order the slot shows an item-count badge and the running
 * total, and tapping it opens the order drawer. Without one it shows the
 * idle "cart" label, and tapping it opens the client-lookup modal to start
 * an order (opensDrawer: false).
 */
const dockCartView = (activeOrder) => {
    if (!activeOrder) {
        return {badgeCount: 0, totalLabel: null, opensDrawer: false};
    }
    const badgeCount = Array.isArray(activeOrder.items) ? activeOrder.items.length : 0;
    const totalLabel = activeOrder.total != null ? `${activeOrder.total}₾` : null;
    return {badgeCount, totalLabel, opensDrawer: true};
};

export default dockCartView;
