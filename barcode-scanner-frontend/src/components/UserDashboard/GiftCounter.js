import React from 'react';
import {GiftOutlined} from '@ant-design/icons';

/**
 * Pill + mini-stepper for marking part of a cart row as a gift
 * (ClickUp 86ca495uu, B1 design). Rendered only when the org has gift
 * marking enabled; the backend independently enforces GIFT_NOT_ENABLED.
 *
 * onChange receives the desired ABSOLUTE gift count (0..totalQty); the
 * caller translates it into line splits via planGiftChange.
 */
const GiftCounter = ({enabled, totalQty, giftQty, onChange, label}) => {
    if (!enabled) return null;
    const state = giftQty === 0 ? 'idle' : (giftQty >= totalQty ? 'full' : 'partial');
    return (
        <div className="m-gift-line">
            <button
                type="button"
                className={`m-gift-pill m-gift-pill-${state}`}
                onClick={() => onChange(giftQty > 0 ? 0 : 1)}
                aria-label={label}
                title={label}
            >
                <GiftOutlined/>
                <span>{giftQty > 0 ? `${giftQty}/${totalQty} ${label}` : label}</span>
            </button>
            {giftQty > 0 && (
                <span className="m-gift-mini">
                    <button type="button" aria-label={`${label} −`}
                            onClick={() => onChange(giftQty - 1)}>−</button>
                    <span className="m-gift-mini-count">{giftQty} / {totalQty}</span>
                    <button type="button" aria-label={`${label} +`}
                            disabled={giftQty >= totalQty}
                            onClick={() => onChange(giftQty + 1)}>+</button>
                </span>
            )}
        </div>
    );
};

export default GiftCounter;
