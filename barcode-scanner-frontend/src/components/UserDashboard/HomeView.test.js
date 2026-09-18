import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import HomeView from './HomeView';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {EMPTY_ORDERS_SUMMARY} from '../../utils/todayOrdersSummary';

const en = translations.en;

const renderHome = (props = {}) => {
    const handlers = {
        onScan: jest.fn(),
        onManualSearch: jest.fn(),
        onResearch: jest.fn(),
        onToggleTheme: jest.fn(),
        onLogout: jest.fn(),
    };
    render(
        <LanguageProvider>
            <HomeView
                username="sopo"
                organizationName="Dika test"
                warehouseNames={['Vake', 'Saburtalo']}
                scansSummary={{count: 0, foundCount: 0, notFoundCount: 0}}
                ordersSummary={EMPTY_ORDERS_SUMMARY}
                recentScans={[]}
                canSearchManually
                {...handlers}
                {...props}
            />
        </LanguageProvider>
    );
    return handlers;
};

describe('HomeView', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('heads the page with the organization and its warehouses, not a "Products" title', () => {
        renderHome();
        // The tab bar already names this place; repeating it in a large title
        // cost a third of the screen above the fold and said nothing.
        expect(screen.queryByRole('heading', {name: en.productsLabel})).toBeNull();
        expect(screen.getByRole('heading', {level: 1, name: 'Dika test · Vake, Saburtalo'})).toBeInTheDocument();
    });

    it('shows the logo variant for the current theme', () => {
        renderHome({isDark: true});
        expect(screen.getByRole('img', {name: 'iFlow'}).getAttribute('src')).toMatch(/logo-dark-wordmark\.png$/);
    });

    it('scans from the prominent button and searches from the gray one', () => {
        const {onScan, onManualSearch} = renderHome();
        fireEvent.click(screen.getByRole('button', {name: en.scan}));
        expect(onScan).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: en.manualSearch}));
        expect(onManualSearch).toHaveBeenCalledTimes(1);
    });

    it('has no manual search without the catalog, since that is where it searches', () => {
        renderHome({canSearchManually: false});
        expect(screen.queryByRole('button', {name: en.manualSearch})).toBeNull();
        expect(screen.getByRole('button', {name: en.scan})).toBeInTheDocument();
    });

    it('renders the banner slot after the large title (e.g. the offline banner)', () => {
        renderHome({banner: <div data-testid="test-banner">Offline</div>});
        const title = screen.getByRole('heading', {level: 1, name: 'Dika test · Vake, Saburtalo'});
        const banner = screen.getByTestId('test-banner');
        // eslint-disable-next-line no-bitwise
        expect(title.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
