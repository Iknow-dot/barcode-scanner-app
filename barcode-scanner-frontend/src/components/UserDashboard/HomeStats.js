import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import {completedShare} from '../../utils/todayOrdersSummary';

const money = (value) => (Number(value) || 0).toFixed(2);

// Home's two stat cards: today's scans, and today's orders — all of them, the
// placed ones (confirmed + completed), and how many of those completed, by
// count and by amount, with a bar for the completed share of the amount.
const HomeStats = ({scansSummary, ordersSummary}) => {
    const {t} = useLanguage();
    const sharePercent = Math.round(completedShare(ordersSummary) * 100);
    return (
        <div className="m-home-stats">
            <section className="if-card" aria-label={t.scansToday}>
                <div className="if-card-label">{t.scansToday}</div>
                <div className="if-card-value">{scansSummary.count}</div>
                <div className="if-card-meta">
                    {t.foundCount(scansSummary.foundCount)} · {t.notFoundCount(scansSummary.notFoundCount)}
                </div>
            </section>
            <section className="if-card" aria-label={t.ordersToday}>
                <div className="if-card-label">{t.ordersToday}</div>
                <div className="if-card-value">{ordersSummary.count}</div>
                <div className="if-card-meta">{t.ordersPlaced(ordersSummary.placedCount)}</div>
                <div className="if-card-meta">{money(ordersSummary.placedTotal)} ₾</div>
                <div className="if-divider"/>
                <div className="m-home-completed">
                    <IosIcon name="check" size={14} stroke={2.8}/>
                    {t.ordersCompletedOfPlaced(ordersSummary.completedCount, ordersSummary.placedCount)}
                </div>
                <div className="if-card-meta">
                    {money(ordersSummary.completedTotal)} / {money(ordersSummary.placedTotal)} ₾
                </div>
                <div className="if-meter" aria-hidden="true">
                    <span className="if-meter-fill" style={{width: `${sharePercent}%`}}/>
                </div>
            </section>
        </div>
    );
};

export default HomeStats;
