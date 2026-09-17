import React from 'react';
import {useLanguage} from '../../i18n/LanguageContext';
import formatRelativeTime from '../../utils/formatRelativeTime';
import IosIcon from '../Common/IosIcon';

// "Recent scans" on Home as an inset grouped list. Tapping a row re-runs that
// lookup (onResearch receives the scan-log entry unchanged).
const RecentScansList = ({scans, onResearch}) => {
    const {t} = useLanguage();
    return (
        <div className="m-home-recent">
            <h2 className="if-section-header">{t.recentScans}</h2>
            {scans.length === 0 ? (
                <div className="if-group if-group-empty">{t.noScansToday}</div>
            ) : (
                <ul className="if-group is-thumb-inset">
                    {scans.map((scan) => (
                        <li key={scan.scanned_at}>
                            <button type="button" className="if-row" onClick={() => onResearch(scan)}>
                                <span className={`if-row-thumb${scan.found ? '' : ' is-warning'}`}>
                                    {scan.found
                                        ? <IosIcon name="package" size={26} stroke={1.8}/>
                                        : <IosIcon name="warn" size={24}/>}
                                </span>
                                <span className="if-row-main">
                                    <span className={`if-row-title${scan.found ? ' if-clamp-2' : ''}`}>
                                        {scan.found ? scan.sku_name : t.notFound}
                                    </span>
                                    <span className="if-row-subtitle">
                                        {`${(scan.found && scan.sku) || scan.search} · ${formatRelativeTime(scan.scanned_at, t)}`}
                                    </span>
                                </span>
                                <span className="if-chev">
                                    <IosIcon name="chev" size={16} stroke={2.4}/>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default RecentScansList;
