import React, {useEffect, useMemo, useState} from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import IosSheet from '../Common/IosSheet';
import ProductImage from '../Common/ProductImage';
import QuantityStepper from '../Common/QuantityStepper';
import OfflineBanner from './OfflineBanner';
import {isStockBlocked, stockStatusMessageKey} from './stockStatus';
import {
    canAddToOrder,
    clampQuantity,
    defaultSelection,
    findOption,
    maxQuantity,
    productSheetView,
    reconcileSelection,
    stockStatusText,
} from './productSheetView';

const LEVEL_GLYPH = {in: 'check', low: 'warn', out: 'warn'};

const OptionPrice = ({option}) => (
    <span className="if-row-subtitle">
        {option.hasDiscount ? (
            <>
                <s>{option.price} ₾</s>
                {' '}
                <span className="m-price-discounted">{option.discountedPrice.toFixed(2)} ₾</span>
                {option.discountPercent > 0 && ` · −${option.discountPercent}%`}
            </>
        ) : `${option.price} ₾`}
    </span>
);

// A warehouse row: pick it (radio) to add from that warehouse.
const WarehouseOptionRow = ({option, selected, onSelect, t}) => (
    <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={!option.selectable}
        className="if-row m-warehouse-option"
        onClick={() => onSelect(option.code)}
    >
        <span className={`if-check${selected ? ' is-on' : ''}`} aria-hidden="true">
            {selected && <IosIcon name="check" size={16} stroke={3}/>}
        </span>
        <span className="if-row-main">
            <span className="if-row-title">{option.name}</span>
            <span className="m-stock-line">
                <span className={`m-stock-glyph is-${option.level}`}>
                    <IosIcon name={LEVEL_GLYPH[option.level]} size={14} stroke={2.6}/>
                </span>
                {stockStatusText(option, t)}
            </span>
            {option.showPrice && <OptionPrice option={option}/>}
            <span className="if-meter" aria-hidden="true">
                <span className={`if-meter-fill is-${option.level}`} style={{width: `${option.fillPercent}%`}}/>
            </span>
        </span>
    </button>
);

/**
 * The product sheet: opened by a scan, a catalog pick or a recent-scan
 * re-run. Shows the product, lets the consultant pick a warehouse row and a
 * quantity, and adds it to the order. It replaces the inline product result
 * and the separate quantity sheet; `onAdd` decides what adding means (add to
 * the active order, or start one first).
 */
const ProductSheet = ({
    open,
    onClose,
    afterClose,
    product,
    imageSrc,
    unitLabel,
    balances,
    userWarehouseNames,
    stockStatus,
    searchedAllWarehouses,
    hasLastSearch,
    othersExpanded,
    othersLoading,
    onToggleOthers,
    adding,
    onAdd,
}) => {
    const {t} = useLanguage();
    const view = useMemo(() => productSheetView({
        balances,
        userWarehouseNames,
        stockBlocked: isStockBlocked(stockStatus),
        searchedAllWarehouses,
        hasLastSearch,
        basePrice: product?.price,
    }), [balances, userWarehouseNames, stockStatus, searchedAllWarehouses, hasLastSearch, product?.price]);

    const [selectedCode, setSelectedCode] = useState(() => defaultSelection(view));
    const [quantity, setQuantity] = useState(1);

    // Re-fetching other warehouses rebuilds the rows: keep the pick if it is
    // still valid.
    useEffect(() => {
        setSelectedCode((code) => reconcileSelection(code, view));
    }, [view]);

    // Every opening starts from the default pick and one unit — keyed on the
    // product too, not just `open`: reconcileSelection above only checks
    // that the WAREHOUSE code is still selectable, so a lookup landing for a
    // different product while the sheet stays open would otherwise keep the
    // previous product's pick and quantity whenever the codes happen to
    // overlap. Declared after the effect above so it wins in that case.
    useEffect(() => {
        if (open) {
            setSelectedCode(defaultSelection(view));
            setQuantity(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, product?.sku]);

    const selected = findOption(view, selectedCode);
    const max = maxQuantity(selected);
    const effectiveQuantity = clampQuantity(quantity, selected);
    const addEnabled = canAddToOrder(selected, effectiveQuantity) && !adding;

    const codeLine = [product?.article || product?.sku, product?.barcode].filter(Boolean).join(' · ');

    const toggleLabel = () => {
        if (view.othersToggle === 'fetch') return t.seeAllWarehouses;
        return othersExpanded ? t.hideOtherWarehouses : t.showOtherWarehouses(view.others.length);
    };

    const renderRows = (options) => options.map((option) => (
        <WarehouseOptionRow
            key={option.key}
            option={option}
            selected={option.code === selectedCode}
            onSelect={setSelectedCode}
            t={t}
        />
    ));

    const bottomBar = (
        <>
            <QuantityStepper
                value={effectiveQuantity}
                min={1}
                max={Math.max(1, max)}
                disabled={max <= 0 || adding}
                onChange={setQuantity}
                label={t.quantity}
                decrementLabel={t.decreaseQuantity}
                incrementLabel={t.increaseQuantity}
            />
            <button
                type="button"
                className="if-btn if-btn-primary"
                disabled={!addEnabled}
                aria-busy={adding || undefined}
                onClick={(event) => onAdd({
                    quantity: effectiveQuantity,
                    warehouse_code: selected.code,
                    warehouse_name: selected.name,
                    price: selected.price,
                }, event.currentTarget)}
            >
                {t.addToOrder}
            </button>
        </>
    );

    const showPrimaryGroup = view.primary.length > 0 || view.othersToggle !== 'hidden';

    return (
        <IosSheet
            open={open}
            onClose={onClose}
            afterClose={afterClose}
            title={t.product}
            bottomBar={bottomBar}
            bottomBarLayout="row"
        >
            <OfflineBanner/>
            <div className="m-product-sheet-media">
                <IosIcon name="package" size={56} stroke={1.4}/>
                {imageSrc && (
                    <ProductImage src={imageSrc} alt={product?.sku_name || ''} className="m-product-sheet-img"/>
                )}
            </div>
            <div className="m-product-sheet-head">
                <h3 className="if-title-3">{product?.sku_name}</h3>
                {codeLine && <div className="if-footnote">{codeLine}</div>}
                {product?.price && (
                    <div className="m-product-sheet-price">
                        <span className="if-title-1">{product.price} ₾</span>
                        {unitLabel && <span className="m-product-sheet-unit">/ {unitLabel}</span>}
                    </div>
                )}
            </div>

            {view.notice === 'blocked' && (
                <div className="if-notice is-warning" role="status">
                    <span className="if-notice-icon"><IosIcon name="warn" size={20}/></span>
                    <span>{t[stockStatusMessageKey(stockStatus)]}</span>
                </div>
            )}
            {view.notice === 'empty' && (
                <div className="if-notice" role="status">
                    <span className="if-notice-icon"><IosIcon name="info" size={20}/></span>
                    <span>{t.outOfStock}</span>
                </div>
            )}

            <div role="radiogroup" aria-label={t.warehouse}>
                {showPrimaryGroup && (
                    <>
                        <h4 className="if-section-header">
                            {view.groupedByMine ? t.myWarehouses : t.warehouses}
                        </h4>
                        <div className="if-group is-lead-inset">
                            {renderRows(view.primary)}
                            {view.othersToggle !== 'hidden' && (
                                <button
                                    type="button"
                                    className="if-row m-others-toggle"
                                    aria-expanded={view.othersToggle === 'fetched' && othersExpanded}
                                    aria-busy={othersLoading || undefined}
                                    disabled={othersLoading}
                                    onClick={onToggleOthers}
                                >
                                    <span className="if-row-label">{toggleLabel()}</span>
                                    <span className={`if-chev m-others-chev${othersExpanded ? ' is-open' : ''}`}>
                                        <IosIcon name="chev" size={16} stroke={2.4}/>
                                    </span>
                                </button>
                            )}
                        </div>
                    </>
                )}
                {othersExpanded && view.others.length > 0 && (
                    <>
                        <h4 className="if-section-header">{t.otherWarehouses}</h4>
                        <div className="if-group is-lead-inset">{renderRows(view.others)}</div>
                    </>
                )}
            </div>
        </IosSheet>
    );
};

export default ProductSheet;
