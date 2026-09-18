import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import TabBar from './TabBar';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

const renderBar = (props) => render(
    <LanguageProvider>
        <TabBar activeTab="scan" onSelectTab={jest.fn()} showSearch {...props}/>
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

    it('selects the catalog tab from the trailing search button', () => {
        const onSelectTab = jest.fn();
        renderBar({onSelectTab});
        fireEvent.click(screen.getByRole('button', {name: en.catalog}));
        expect(onSelectTab).toHaveBeenCalledWith('catalog');
    });

    it('marks the trailing search button selected when the catalog tab is active', () => {
        renderBar({activeTab: 'catalog'});
        const search = screen.getByRole('button', {name: en.catalog});
        expect(search).toHaveClass('if-search-tab', 'is-on');
        expect(search).toHaveAttribute('aria-current', 'page');
        const products = screen.getByRole('button', {name: en.productsLabel});
        const orders = screen.getByRole('button', {name: en.orders});
        expect(products).not.toHaveClass('is-on');
        expect(orders).not.toHaveClass('is-on');
    });

    it('leaves the trailing search button unselected when a real tab is active', () => {
        renderBar({activeTab: 'scan'});
        const search = screen.getByRole('button', {name: en.catalog});
        expect(search).not.toHaveClass('is-on');
        expect(search).not.toHaveAttribute('aria-current');
    });

    // The selected pill is one sliding element, not a background each button
    // turns on and off — so its position, not its existence, is what says
    // which tab is selected.
    it('parks the sliding pill over the selected tab', () => {
        const {rerender} = renderBar({activeTab: 'scan'});
        expect(screen.getByTestId('tab-thumb')).toHaveStyle({transform: 'translateX(0%)'});

        rerender(
            <LanguageProvider>
                <TabBar activeTab="orders" onSelectTab={jest.fn()} showSearch/>
            </LanguageProvider>
        );
        // Same element moved rather than a second pill appearing: two pills
        // would mean the background is still per-button.
        expect(screen.getAllByTestId('tab-thumb')).toHaveLength(1);
        expect(screen.getByTestId('tab-thumb')).toHaveStyle({transform: 'translateX(100%)'});
    });

    it('shows no pill in the track while the catalog is the active screen', () => {
        renderBar({activeTab: 'catalog'});
        // The catalog's tab is the trailing round button, outside this track;
        // a pill parked over Products would say the wrong thing.
        expect(screen.queryByTestId('tab-thumb')).toBeNull();
    });

    it('leaves out the search tab when the catalog is off', () => {
        renderBar({showSearch: false});
        expect(screen.queryByRole('button', {name: en.catalog})).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });
});
