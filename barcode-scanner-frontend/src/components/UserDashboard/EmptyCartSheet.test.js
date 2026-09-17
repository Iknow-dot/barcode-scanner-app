import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import EmptyCartSheet from './EmptyCartSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

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

const renderSheet = (props = {}) => {
    const handlers = {onClose: jest.fn(), onScan: jest.fn(), onManualSearch: jest.fn()};
    render(
        <LanguageProvider>
            <EmptyCartSheet open canSearchManually {...handlers} {...props}/>
        </LanguageProvider>
    );
    return handlers;
};

describe('EmptyCartSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('says the cart is empty and how to fill it, with no order menu', () => {
        renderSheet();
        const sheet = screen.getByRole('dialog', {name: en.cart});
        expect(sheet).toHaveTextContent(en.cartEmptyTitle);
        expect(sheet).toHaveTextContent(en.scanToAddProduct);
        expect(screen.queryByRole('button', {name: en.moreActions})).toBeNull();
    });

    it('scans from the prominent button and searches from the gray one', () => {
        const {onScan, onManualSearch} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.scan}));
        expect(onScan).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: en.manualSearch}));
        expect(onManualSearch).toHaveBeenCalledTimes(1);
    });

    it('has no manual search without the catalog', () => {
        renderSheet({canSearchManually: false});
        expect(screen.queryByRole('button', {name: en.manualSearch})).toBeNull();
    });

    it('keeps a zero total and a disabled Next in the bar', () => {
        renderSheet();
        expect(screen.getByText(en.cartTotalCount(0))).toBeInTheDocument();
        expect(screen.getByText('0.00 ₾')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: en.nextStep})).toBeDisabled();
    });

    it('closes from the close button', () => {
        const {onClose} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
