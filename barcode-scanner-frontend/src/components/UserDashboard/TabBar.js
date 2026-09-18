import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';

const TABS = [
    {key: 'scan', icon: 'tab-products', label: (t) => t.productsLabel},
    {key: 'orders', icon: 'tab-orders', label: (t) => t.orders},
];

// Floating glass tab bar: places only (Products, Orders). The trailing round
// search tab selects the catalog — a real tab, through the same
// onSelectTab as Products/Orders — and exists only when the org has it
// enabled. It stays visually a round search button, apart from the two
// labeled tabs, but shows the same selected state (is-on / aria-current)
// when the catalog is the active screen.
const TabBar = ({activeTab, onSelectTab, showSearch}) => {
    const {t} = useLanguage();
    return (
        <nav className="if-tabbar" aria-label={t.tabBarLabel}>
            <div className="if-tabs">
                {TABS.map(({key, icon, label}) => {
                    const on = activeTab === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            className={`if-tab${on ? ' is-on' : ''}`}
                            aria-current={on ? 'page' : undefined}
                            onClick={() => onSelectTab(key)}
                        >
                            <IosIcon name={icon} size={24}/>
                            <span className="if-tab-label">{label(t)}</span>
                        </button>
                    );
                })}
            </div>
            {showSearch && (
                <button
                    type="button"
                    className={`if-search-tab${activeTab === 'catalog' ? ' is-on' : ''}`}
                    aria-label={t.catalog}
                    aria-current={activeTab === 'catalog' ? 'page' : undefined}
                    onClick={() => onSelectTab('catalog')}
                >
                    <IosIcon name="search" size={26} stroke={2.4}/>
                </button>
            )}
        </nav>
    );
};

export default TabBar;
