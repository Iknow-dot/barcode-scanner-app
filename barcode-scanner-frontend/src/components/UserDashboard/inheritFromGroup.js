/**
 * Read the override-inheritable fields from a grouped order item. Returns
 * an object suitable for spreading into an addOrderItem payload.
 *
 * @param {object} group - A group object as produced by groupItemsBySku.
 * @param {boolean} canApplyDiscount - Whether the current user has discount permission.
 * @returns {object} Partial payload — possibly {discounted_price, discount_percent, unit}.
 */
const inheritFromGroup = (group, canApplyDiscount) => {
    if (!group) return {};
    const inherited = {};
    if (canApplyDiscount) {
        if (!group.isMixedPrice && group.sharedDiscountedPrice != null) {
            inherited.discounted_price = group.sharedDiscountedPrice;
        }
        if (!group.isMixedDiscount && parseFloat(group.sharedDiscountPercent || 0) > 0) {
            inherited.discount_percent = group.sharedDiscountPercent;
        }
    }
    if (!group.isMixedUnit && group.sharedUnit) {
        inherited.unit = group.sharedUnit;
    }
    return inherited;
};

export default inheritFromGroup;
