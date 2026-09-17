import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import TabBar from './TabBar';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

const renderBar = (props) => render(
    <LanguageProvider>
        <TabBar activeTab="scan" onSelectTab={jest.fn()} showSearch onSearch={jest.fn()} {...props}/>
    </LanguageProvider>
);

describe('TabBar', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('marks the selected tab and only that one', () => {
        renderBar({activeTab: 'orders'});
        const products = screen.getByRole('button', {name: en.productsLabel});
        const orders = screen.getByRole('button', {name: en.orders});
        expect(orders).toHaveClass('if-tab', 'is-on');
        expect(orders).toHaveAttribute('aria-current', 'page');
        expect(products).not.toHaveClass('is-on');
        expect(products).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('navigation', {name: en.tabBarLabel})).toBeInTheDocument();
    });

    it('reports the tab the user picks', () => {
        const onSelectTab = jest.fn();
        renderBar({onSelectTab});
        fireEvent.click(screen.getByRole('button', {name: en.orders}));
        expect(onSelectTab).toHaveBeenCalledWith('orders');
        fireEvent.click(screen.getByRole('button', {name: en.productsLabel}));
        expect(onSelectTab).toHaveBeenLastCalledWith('scan');
    });

    it('opens the catalog from the trailing search tab', () => {
        const onSearch = jest.fn();
        renderBar({onSearch});
        fireEvent.click(screen.getByRole('button', {name: en.catalog}));
        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('leaves out the search tab when the catalog is off', () => {
        renderBar({showSearch: false});
        expect(screen.queryByRole('button', {name: en.catalog})).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });
});
