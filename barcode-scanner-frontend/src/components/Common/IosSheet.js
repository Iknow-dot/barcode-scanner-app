import React, {useId, useRef} from 'react';
import {Drawer} from 'antd';
import {useLanguage} from '../../i18n/LanguageContext';
import {sheetZIndex} from '../../theme/layers';
import IosIcon from './IosIcon';
import {swipeClosesSheet} from './sheetSwipe';

// Large detent: the whole screen less a strip at the top, so the screen
// behind stays visible as context and the status bar or notch stays clear.
export const SHEET_HEIGHT = 'calc(100% - max(24px, env(safe-area-inset-top, 0px) + 10px))';

/**
 * iOS bottom sheet on antd's Drawer, which brings the portal, the mask, the
 * focus trap, Escape to close and antd's z-index context for popups opened
 * inside. On top of it: a grabber, a navbar with a round glass close or back
 * button, a centred title and an optional trailing control, scrolling
 * content on the grouped background, and an optional floating glass action
 * bar. Dragging down from the top of the content closes it.
 *
 * The sheet is layer 900 (src/theme/layers.js): above the floating bars,
 * below every antd overlay, so a modal or confirm opened from it lands on top.
 *
 * `level` (default 0) stacks a sheet opened from inside another sheet above
 * it — each level adds LAYER_SHEET_STEP, clamped below every antd overlay
 * (src/theme/layers.js::sheetZIndex). `push={false}` on the Drawer keeps a
 * lower sheet from being shoved sideways when a higher one opens on top.
 */
const IosSheet = ({
    open,
    onClose,
    afterClose,
    title,
    subtitle,
    leading = 'close',
    onBack,
    trailing,
    bottomBar,
    bottomBarLayout = 'column',
    swipeToClose = true,
    level = 0,
    children,
}) => {
    const {t} = useLanguage();
    const titleId = useId();
    const scrollRef = useRef(null);
    const swipeRef = useRef({startY: 0, fired: true});

    const handleTouchStart = (event) => {
        // A touch that starts in a popup portaled out of the sheet (a date
        // picker, say) still bubbles here through React; it must not drag.
        swipeRef.current = {
            startY: event.touches[0].clientY,
            fired: !event.currentTarget.contains(event.target),
        };
    };

    const handleTouchMove = (event) => {
        const swipe = swipeRef.current;
        if (!swipeToClose || swipe.fired || !scrollRef.current) return;
        const deltaY = event.touches[0].clientY - swipe.startY;
        if (swipeClosesSheet(scrollRef.current.scrollTop, deltaY)) {
            swipe.fired = true;
            onClose();
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            afterOpenChange={(visible) => {
                if (!visible && afterClose) afterClose();
            }}
            placement="bottom"
            size={SHEET_HEIGHT}
            zIndex={sheetZIndex(level)}
            push={false}
            closable={false}
            destroyOnHidden
            rootClassName="if-sheet"
            aria-labelledby={titleId}
        >
            <div
                className="if-sheet-frame"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
            >
                <div className="if-sheet-grabber" aria-hidden="true"/>
                <div className="if-sheet-navbar">
                    {leading === 'back' ? (
                        <button type="button" className="if-glass-btn" aria-label={t.back} onClick={onBack}>
                            <IosIcon name="back" size={20} stroke={2.4}/>
                        </button>
                    ) : (
                        <button type="button" className="if-glass-btn" aria-label={t.close} onClick={onClose}>
                            <IosIcon name="close" size={20} stroke={2.4}/>
                        </button>
                    )}
                    <div className="if-sheet-heading">
                        <h2 id={titleId} className="if-sheet-title">{title}</h2>
                        {subtitle && <div className="if-sheet-subtitle">{subtitle}</div>}
                    </div>
                    {trailing || <span className="if-sheet-nav-spacer" aria-hidden="true"/>}
                </div>
                <div className="if-sheet-scroll" ref={scrollRef}>
                    <div className="if-sheet-content">{children}</div>
                    {bottomBar && (
                        <div className={`if-sheet-bar${bottomBarLayout === 'row' ? ' is-row' : ''}`}>
                            {bottomBar}
                        </div>
                    )}
                </div>
            </div>
        </Drawer>
    );
};

export default IosSheet;
