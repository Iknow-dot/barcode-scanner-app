import React from 'react';
import {render, screen, within} from '@testing-library/react';
import HomeStats from './HomeStats';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {EMPTY_ORDERS_SUMMARY} from '../../utils/todayOrdersSummary';

const en = translations.en;

const SCANS = {count: 14, foundCount: 12, notFoundCount: 2};
const ORDERS = {
    count: 3,
    total: 761.9,
    placedCount: 2,
    placedTotal: 761.9,
    completedCount: 1,
    completedTotal: 672,
};

const renderStats = (scansSummary, ordersSummary) => render(
    <LanguageProvider>
        <HomeStats scansSummary={scansSummary} ordersSummary={ordersSummary}/>
    </LanguageProvider>
);

describe('HomeStats', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('shows today\'s scans with found and not-found counts', () => {
        renderStats(SCANS, ORDERS);
        const card = screen.getByRole('region', {name: en.scansToday});
        expect(within(card).getByText('14')).toBeInTheDocument();
        expect(within(card).getByText('12 found · 2 not found')).toBeInTheDocument();
    });

    it('shows today\'s orders, the placed ones and how many completed', () => {
        renderStats(SCANS, ORDERS);
        const card = screen.getByRole('region', {name: en.ordersToday});
        expect(within(card).getByText('3')).toBeInTheDocument();
        expect(within(card).getByText('Placed 2')).toBeInTheDocument();
        expect(within(card).getByText('761.90 ₾')).toBeInTheDocument();
        expect(within(card).getByText('Completed 1 / 2')).toBeInTheDocument();
        expect(within(card).getByText('672.00 / 761.90 ₾')).toBeInTheDocument();
    });

    it('fills the bar with the completed share of the placed amount', () => {
        const {container} = renderStats(SCANS, ORDERS);
        expect(container.querySelector('.if-meter-fill').style.width).toBe('88%');
    });

    it('keeps an empty bar and zero amounts before anything is placed', () => {
        const {container} = renderStats({count: 0, foundCount: 0, notFoundCount: 0}, EMPTY_ORDERS_SUMMARY);
        const card = screen.getByRole('region', {name: en.ordersToday});
        expect(within(card).getByText('Completed 0 / 0')).toBeInTheDocument();
        expect(within(card).getByText('0.00 / 0.00 ₾')).toBeInTheDocument();
        expect(container.querySelector('.if-meter-fill').style.width).toBe('0%');
    });
});
