import React from 'react';
import IosIcon from '../Common/IosIcon';

// Where the add-to-cart fly animation (UserDashboard's animateAddToCart) and
// its pulse class land — shared so the two stay in sync.
export const ACTIVE_ORDER_ICON_SELECTOR = '.if-accessory .if-acc-icon';

const badgeText = (count) => (count > 99 ? '99+' : String(count));

// The glass bar above the tab bar. `view` comes from activeOrderBarView; the
// whole bar is one button, and `.if-acc-icon` is where the add-to-cart ball
// lands (UserDashboard's animateAddToCart).
const ActiveOrderBar = ({view, onOpen}) => (
    <button
        type="button"
        className={`if-accessory${view.active ? '' : ' is-idle'}`}
        onClick={onOpen}
    >
        <span className="if-acc-icon">
            <IosIcon name="cart" size={22}/>
            {view.badgeCount > 0 && (
                <span className="if-acc-badge">{badgeText(view.badgeCount)}</span>
            )}
        </span>
        <span className="if-accessory-text">
            <span className="if-accessory-title">{view.title}</span>
            <span className="if-accessory-subtitle">{view.subtitle}</span>
        </span>
        <span className="if-chev if-accessory-chev">
            <IosIcon name="chev" size={18} stroke={2.4}/>
        </span>
    </button>
);

export default ActiveOrderBar;
