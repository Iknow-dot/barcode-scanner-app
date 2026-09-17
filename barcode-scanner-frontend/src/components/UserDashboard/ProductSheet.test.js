import React from 'react';
import {render, screen, fireEvent, within} from '@testing-library/react';
import ProductSheet from './ProductSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {markOffline, markOnline} from '../../utils/connectivity';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer touches.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

const PRODUCT = {
    sku_name: 'Granite pan 28 cm',
    article: 'MG-2814',
    sku: '000000007126',
    barcode: '4860112028140',
    price: '89.90',
    images: [],
};
const VAKE = {warehouse: 'W1', warehouse_name: 'Vake', quantity: '3.000', reserve: '2.000', price: '89.90'};
const CENTRAL = {warehouse: 'W2', warehouse_name: 'Central', quantity: '12.000', price: '89.90'};
const EMPTY = {warehouse: 'W3', warehouse_name: 'Saburtalo', quantity: '0.000', price: '89.90'};
const BATUMI = {warehouse: 'W9', warehouse_name: 'Batumi', quantity: '7.000', price: '95.00'};

const renderSheet = (props = {}) => {
    const handlers = {onClose: jest.fn(), onToggleOthers: jest.fn(), onAdd: jest.fn()};
    const utils = render(
        <LanguageProvider>
            <ProductSheet
                open
                product={PRODUCT}
                imageSrc=""
                unitLabel="Piece"
                balances={[VAKE, CENTRAL, EMPTY]}
                userWarehouseNames={['Vake', 'Central', 'Saburtalo']}
                stockStatus=""
                searchedAllWarehouses={false}
                hasLastSearch
                othersExpanded={false}
                othersLoading={false}
                adding={false}
                {...handlers}
                {...props}
            />
        </LanguageProvider>
    );
    return {...handlers, ...utils};
};

const radio = (name) => screen.getByRole('radio', {name: new RegExp(name)});
const addButton = () => screen.getByRole('button', {name: en.addToOrder});
const plus = () => screen.getByRole('button', {name: en.increaseQuantity});

describe('ProductSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
        markOnline();
    });

    it('shows the offline banner while offline, so adding is not silent', () => {
        markOffline();
        renderSheet();
        expect(screen.getByText(en.offlineBanner)).toBeInTheDocument();
    });

    it('shows the product name, codes, price per unit and my warehouses', () => {
        renderSheet();
        const sheet = screen.getByRole('dialog', {name: en.product});
        expect(within(sheet).getByRole('heading', {name: 'Granite pan 28 cm'})).toBeInTheDocument();
        expect(sheet).toHaveTextContent('MG-2814 · 4860112028140');
        expect(sheet).toHaveTextContent('89.90 ₾');
        expect(sheet).toHaveTextContent('/ Piece');
        expect(within(sheet).getByRole('heading', {name: en.myWarehouses})).toBeInTheDocument();
        expect(radio('Vake')).toHaveTextContent('Low stock · 3 free · 2 reserved');
    });

    it('picks the first of my warehouses with stock and disables empty ones', () => {
        renderSheet({balances: [EMPTY, VAKE, CENTRAL]});
        expect(radio('Vake')).toHaveAttribute('aria-checked', 'true');
        expect(radio('Central')).toHaveAttribute('aria-checked', 'false');
        expect(radio('Saburtalo')).toBeDisabled();
    });

    it('moves the check to the row the consultant taps', () => {
        renderSheet();
        fireEvent.click(radio('Central'));
        expect(radio('Central')).toHaveAttribute('aria-checked', 'true');
        expect(radio('Vake')).toHaveAttribute('aria-checked', 'false');
    });

    it('lets the quantity grow only to the free stock of the selected warehouse', () => {
        renderSheet();
        fireEvent.click(plus());
        fireEvent.click(plus());
        expect(screen.getByRole('textbox', {name: en.quantity})).toHaveValue('3');
        expect(plus()).toBeDisabled();
        fireEvent.click(radio('Central'));
        expect(plus()).not.toBeDisabled();
    });

    it('adds the chosen warehouse, quantity and price', () => {
        const {onAdd} = renderSheet();
        fireEvent.click(radio('Central'));
        fireEvent.click(plus());
        fireEvent.click(addButton());
        expect(onAdd).toHaveBeenCalledWith(
            {quantity: 2, warehouse_code: 'W2', warehouse_name: 'Central', price: '89.90'},
            addButton(),
        );
    });

    it('cannot add when no warehouse has stock', () => {
        renderSheet({balances: [EMPTY]});
        expect(addButton()).toBeDisabled();
        expect(plus()).toBeDisabled();
    });

    it('cannot add while an add is in flight', () => {
        renderSheet({adding: true});
        expect(addButton()).toBeDisabled();
    });

    it('explains blocked stock instead of listing warehouses', () => {
        renderSheet({stockStatus: 'unavailable'});
        expect(screen.getByRole('status')).toHaveTextContent(en.stockUnavailable);
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        expect(addButton()).toBeDisabled();
    });

    it('says the product is out of stock when no balance came back', () => {
        renderSheet({balances: []});
        expect(screen.getByRole('status')).toHaveTextContent(en.outOfStock);
    });

    it('offers to fetch other warehouses before they were requested', () => {
        const {onToggleOthers} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.seeAllWarehouses}));
        expect(onToggleOthers).toHaveBeenCalledTimes(1);
    });

    it('shows fetched other warehouses when expanded, selectable too', () => {
        renderSheet({balances: [VAKE, BATUMI], searchedAllWarehouses: true, othersExpanded: true});
        expect(screen.getByRole('button', {name: en.hideOtherWarehouses})).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('heading', {name: en.otherWarehouses})).toBeInTheDocument();
        expect(radio('Batumi')).toHaveTextContent('95.00 ₾');
        fireEvent.click(radio('Batumi'));
        expect(radio('Batumi')).toHaveAttribute('aria-checked', 'true');
    });

    it('counts fetched other warehouses while they are collapsed', () => {
        renderSheet({balances: [VAKE, BATUMI], searchedAllWarehouses: true, othersExpanded: false});
        expect(screen.getByRole('button', {name: en.showOtherWarehouses(1)})).toBeInTheDocument();
        expect(screen.queryByRole('radio', {name: /Batumi/})).toBeNull();
    });

    it('resets to the default pick and quantity 1 when reopened, even with a different product', () => {
        const {rerender} = renderSheet();
        fireEvent.click(radio('Central'));
        fireEvent.click(plus());
        expect(radio('Central')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('textbox', {name: en.quantity})).toHaveValue('2');

        const wrap = (props) => (
            <LanguageProvider>
                <ProductSheet
                    onClose={() => {}}
                    onToggleOthers={() => {}}
                    onAdd={() => {}}
                    imageSrc=""
                    unitLabel="Piece"
                    stockStatus=""
                    searchedAllWarehouses={false}
                    hasLastSearch
                    othersExpanded={false}
                    othersLoading={false}
                    adding={false}
                    {...props}
                />
            </LanguageProvider>
        );

        // Close...
        rerender(wrap({open: false, product: PRODUCT, balances: [VAKE, CENTRAL, EMPTY]}));
        // ...then reopen with a different product's options.
        rerender(wrap({
            open: true,
            product: {...PRODUCT, sku_name: 'Different product'},
            balances: [EMPTY, VAKE, CENTRAL],
        }));

        expect(radio('Vake')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('textbox', {name: en.quantity})).toHaveValue('1');
    });

    it('resets the pick and quantity when a lookup for a different product lands while still open', () => {
        // F6: reconcileSelection only checks the WAREHOUSE code is still
        // selectable, so if the new product also has stock at the same
        // code, the old pick (and its quantity) would otherwise survive.
        const {rerender} = renderSheet();
        fireEvent.click(radio('Central'));
        fireEvent.click(plus());
        expect(radio('Central')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('textbox', {name: en.quantity})).toHaveValue('2');

        rerender(
            <LanguageProvider>
                <ProductSheet
                    open
                    onClose={() => {}}
                    onToggleOthers={() => {}}
                    onAdd={() => {}}
                    product={{...PRODUCT, sku: 'OTHER-SKU', article: 'OTHER-ART', sku_name: 'Different product'}}
                    imageSrc=""
                    unitLabel="Piece"
                    balances={[VAKE, CENTRAL]}
                    userWarehouseNames={['Vake', 'Central', 'Saburtalo']}
                    stockStatus=""
                    searchedAllWarehouses={false}
                    hasLastSearch
                    othersExpanded={false}
                    othersLoading={false}
                    adding={false}
                />
            </LanguageProvider>
        );

        expect(screen.getByRole('textbox', {name: en.quantity})).toHaveValue('1');
    });
});
