import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import RecentScansList from './RecentScansList';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;
const MINUTE = 60 * 1000;

const FOUND = {
    search: '4860001234567',
    searchType: 'barcode',
    found: true,
    sku: 'MG-2814',
    sku_name: 'Granite pan 28 cm',
    scanned_at: Date.now() - 2 * MINUTE,
};
const NOT_FOUND = {
    search: '4860009999999',
    searchType: 'barcode',
    found: false,
    sku: null,
    sku_name: null,
    scanned_at: Date.now() - 9 * MINUTE,
};

const renderList = (scans, onResearch = jest.fn()) => render(
    <LanguageProvider>
        <RecentScansList scans={scans} onResearch={onResearch}/>
    </LanguageProvider>
);

describe('RecentScansList', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('lists a found scan by name with its SKU and time', () => {
        renderList([FOUND]);
        expect(screen.getByRole('heading', {name: en.recentScans})).toBeInTheDocument();
        expect(screen.getByText('Granite pan 28 cm')).toBeInTheDocument();
        expect(screen.getByText('MG-2814 · 2 min ago')).toBeInTheDocument();
    });

    it('shows a not-found scan with the warning thumb and the scanned code', () => {
        const {container} = renderList([NOT_FOUND]);
        expect(screen.getByText(en.notFound)).toBeInTheDocument();
        expect(screen.getByText('4860009999999 · 9 min ago')).toBeInTheDocument();
        expect(container.querySelector('.if-row-thumb.is-warning [data-icon="warn"]')).not.toBeNull();
    });

    it('re-runs the lookup for the tapped row', () => {
        const onResearch = jest.fn();
        renderList([FOUND, NOT_FOUND], onResearch);
        fireEvent.click(screen.getByRole('button', {name: /Granite pan 28 cm/}));
        expect(onResearch).toHaveBeenCalledWith(FOUND);
    });

    it('says there are no scans yet today when the list is empty', () => {
        renderList([]);
        expect(screen.getByText(en.noScansToday)).toBeInTheDocument();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
