import React from 'react';
import IosIcon from '../Common/IosIcon';

/**
 * Gift marker for a cart row (ClickUp 86ca495uu): a pill that toggles the
 * gift, plus a small stepper for how many units are gifts when the row has
 * more than one unit. Rendered only when the org has gift marking enabled;
 * the backend independently enforces GIFT_NOT_ENABLED.
 *
 * onChange receives the desired ABSOLUTE gift count (0..totalQty); the
 * caller translates it into line splits via planGiftChange. `disabled` (a
 * change already in flight) covers the pill and both stepper buttons.
 */
const GiftCounter = ({enabled, totalQty, giftQty, onChange, label, disabled = false}) => {
    if (!enabled) return null;
    const gifted = giftQty > 0;
    const showSplit = gifted && totalQty > 1;
    // The split is otherwise only visible as text inside the pill; an
    // assistive-tech user hears the bare label unless the name carries it.
    const pillLabel = showSplit ? `${giftQty}/${totalQty} ${label}` : label;
    return (
        <div className="m-gift">
            <button
                type="button"
                className={`if-pill${gifted ? ' is-on' : ''}`}
                aria-pressed={gifted}
                disabled={disabled}
                onClick={() => onChange(gifted ? 0 : 1)}
                aria-label={pillLabel}
                title={pillLabel}
            >
                <IosIcon name={gifted ? 'check' : 'gift'} size={16} stroke={gifted ? 2.6 : 2}/>
                <span>{showSplit ? `${giftQty}/${totalQty} ${label}` : label}</span>
            </button>
            {showSplit && (
                <span className="if-stepper">
                    <button type="button" className="if-stepper-btn" aria-label={`${label} −`}
                            disabled={disabled}
                            onClick={() => onChange(giftQty - 1)}>
                        <IosIcon name="minus" size={18} stroke={2.4}/>
                    </button>
                    <span className="m-gift-count">{giftQty} / {totalQty}</span>
                    <button type="button" className="if-stepper-btn" aria-label={`${label} +`}
                            disabled={disabled || giftQty >= totalQty}
                            onClick={() => onChange(giftQty + 1)}>
                        <IosIcon name="plus" size={18} stroke={2.4}/>
                    </button>
                </span>
            )}
        </div>
    );
};

export default GiftCounter;
