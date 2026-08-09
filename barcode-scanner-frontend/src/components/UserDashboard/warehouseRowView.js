/**
 * Display model for one warehouse balance row of a product search result.
 *
 * The backend relays 1C stock rows with DRF decimal STRINGS ("3.000",
 * "29.45") and omits `reserve` / `discount_percent` / `discounted_price`
 * entirely when the 1C base doesn't send them — this normalizes all of that
 * into plain numbers plus render flags so the JSX stays declarative.
 *
 * `quantity` is the FREE stock; `reserve` is shown separately and is never
 * sellable. A row with 0 free but a positive reserve still renders (the
 * consultant needs to see why the shelf looks full while nothing is
 * sellable).
 */
export const warehouseRowView = (item) => {
    const qty = Number(item.quantity) || 0;
    const reserve = Number(item.reserve) || 0;
    const price = item.price != null ? Number(item.price) : null;
    const discountPercent = Number(item.discount_percent) || 0;

    let discountedPrice = item.discounted_price != null ? Number(item.discounted_price) : null;
    if (discountedPrice == null && discountPercent > 0 && price != null) {
        discountedPrice = Math.round(price * (100 - discountPercent)) / 100;
    }
    const hasDiscount = (
        discountedPrice != null && price != null && discountedPrice < price
    );

    return {
        qty,
        reserve,
        hasReserve: reserve > 0,
        hasDiscount,
        discountPercent,
        discountedPrice: hasDiscount || discountedPrice != null ? discountedPrice : null,
    };
};

/**
 * Unit precedence for a new order line: a unit shared by the product's
 * existing group in the order wins (keeps the group consistent), else the
 * per-lookup-key unit 1C reported on the search.
 */
export const pickUnit = (inheritedUnit, productUnit) => inheritedUnit || productUnit || '';
