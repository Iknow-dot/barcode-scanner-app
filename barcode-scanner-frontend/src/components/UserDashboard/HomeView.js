import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import AccountMenuButton from './AccountMenuButton';
import HomeStats from './HomeStats';
import RecentScansList from './RecentScansList';

// Home: the scan tab when no product result is showing. Top bar (logo +
// account menu), large title with organization and warehouses, today's stats,
// scanning as the one prominent button, manual search, and recent scans.
const HomeView = ({
    isDark = false,
    username,
    organizationName,
    warehouseNames = [],
    scansSummary,
    ordersSummary,
    recentScans,
    canSearchManually,
    onScan,
    onManualSearch,
    onResearch,
    onToggleTheme,
    onLogout,
    banner,
}) => {
    const {t} = useLanguage();
    const subtitle = [organizationName, warehouseNames.join(', ')].filter(Boolean).join(' · ');
    const logo = isDark ? 'logo-dark-wordmark.png' : 'logo-light-wordmark.png';
    return (
        <div className="m-home">
            <div className="if-navbar">
                {/* Plain anchor so tapping the logo reloads the app, as the
                    old header logo did. */}
                <a href={window.location.pathname} className="if-navbar-logo-link">
                    <img className="if-navbar-logo" src={`${process.env.PUBLIC_URL}/${logo}`} alt="iFlow"/>
                </a>
                <AccountMenuButton
                    username={username}
                    isDark={isDark}
                    onToggleTheme={onToggleTheme}
                    onLogout={onLogout}
                />
            </div>
            {/* No "Products" title: the tab bar already names this place, so
                the large title only repeated it and cost a third of the screen
                above the fold. The organisation and its warehouses carry the
                heading instead — the one thing here a consultant cannot read
                off the rest of the screen. */}
            {subtitle && (
                <div className="if-large-header">
                    <h1 className="if-large-subtitle if-clamp-2">{subtitle}</h1>
                </div>
            )}
            {banner}
            <HomeStats scansSummary={scansSummary} ordersSummary={ordersSummary}/>
            <div className="m-home-actions">
                <button type="button" className="if-btn if-btn-primary" onClick={onScan}>
                    <IosIcon name="scan" size={22} stroke={2.2}/>
                    {t.scan}
                </button>
                {canSearchManually && (
                    <button type="button" className="if-btn if-btn-gray" onClick={onManualSearch}>
                        <IosIcon name="keyboard" size={22}/>
                        {t.manualSearch}
                    </button>
                )}
            </div>
            <RecentScansList scans={recentScans} onResearch={onResearch}/>
        </div>
    );
};

export default HomeView;
