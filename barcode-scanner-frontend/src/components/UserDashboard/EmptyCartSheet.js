import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';

/**
 * The cart with no order yet: no client and no products, so no ⋯ menu. It
 * offers the two ways to add a product — scanning (the one prominent button)
 * and manual search (the catalog, only when the org has it) — and keeps the
 * total and a disabled "Next" in the bar so it matches the full cart.
 */
const EmptyCartSheet = ({open, onClose, canSearchManually, onScan, onManualSearch}) => {
    const {t} = useLanguage();
    const bottomBar = (
        <>
            <div className="if-sheet-total">
                <span className="if-sheet-total-label">{t.cartTotalCount(0)}</span>
                <span className="if-title-2 if-sheet-total-value is-muted">0.00 ₾</span>
            </div>
            <button type="button" className="if-btn if-btn-primary" disabled>
                {t.nextStep}
            </button>
        </>
    );
    return (
        <IosSheet open={open} onClose={onClose} title={t.cart} bottomBar={bottomBar}>
            <div className="if-empty">
                <div className="if-empty-icon" aria-hidden="true">
                    <IosIcon name="cart" size={40} stroke={1.8}/>
                </div>
                <h3 className="if-empty-title">{t.cartEmptyTitle}</h3>
                <p className="if-empty-text">{t.scanToAddProduct}</p>
            </div>
            <div className="if-empty-actions">
                <button type="button" className="if-btn if-btn-primary" onClick={onScan}>
                    <IosIcon name="scan" size={22} stroke={2.2}/>
                    {t.scan}
                </button>
                {canSearchManually && (
                    <button type="button" className="if-btn if-btn-gray" onClick={onManualSearch}>
                        <IosIcon name="keyboard" size={22}/>
                        {t.manualSearch}
                    </button>
                )}
            </div>
        </IosSheet>
    );
};

export default EmptyCartSheet;
