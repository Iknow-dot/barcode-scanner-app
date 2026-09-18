import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosSheet from './IosSheet';

/**
 * iOS action sheet: a list of choices on top of IosSheet (so it inherits the
 * portal, mask, Escape and focus trap), with Cancel set apart in its own
 * group below the action list — the UIActionSheet layout. Rows reuse
 * .if-row/.if-group rather than redeclaring the 44px touch target and the
 * active/focus states; only alignment and colour (src/theme/ios.css,
 * "Action sheet") differ from a plain list row.
 *
 * `actions`: [{key, label, icon?, destructive?, onSelect}]. Selecting a row
 * calls its `onSelect` and then closes the sheet; Cancel only closes.
 *
 * `level` (default 0) passes straight through to IosSheet, for a caller that
 * opens this over a sheet already on screen (see IosSheet.js's own `level`
 * doc) — e.g. an order's own ⋯ menu, opened while the order sheet is up.
 */
const IosActionSheet = ({open, onClose, title, actions = [], cancelLabel, level = 0}) => {
    const {t} = useLanguage();

    const select = (action) => {
        action.onSelect?.();
        onClose();
    };

    return (
        <IosSheet open={open} onClose={onClose} title={title} level={level}>
            <ul className="if-group if-action-sheet-group">
                {actions.map((action) => {
                    const hintId = action.destructive ? `if-action-sheet-hint-${action.key}` : undefined;
                    return (
                        <li key={action.key}>
                            <button
                                type="button"
                                className={`if-row if-action-sheet-row${action.destructive ? ' is-destructive' : ''}`}
                                aria-describedby={hintId}
                                onClick={() => select(action)}
                            >
                                {action.icon && (
                                    <span className="if-row-icon" aria-hidden="true">{action.icon}</span>
                                )}
                                <span className="if-row-label">{action.label}</span>
                            </button>
                            {action.destructive && (
                                <span id={hintId} className="if-visually-hidden">{t.destructiveAction}</span>
                            )}
                        </li>
                    );
                })}
            </ul>
            <ul className="if-group if-action-sheet-cancel-group">
                <li>
                    <button type="button" className="if-row if-action-sheet-row" onClick={onClose}>
                        <span className="if-row-label">{cancelLabel || t.cancel}</span>
                    </button>
                </li>
            </ul>
        </IosSheet>
    );
};

export default IosActionSheet;
