import React, {useCallback, useEffect, useState} from 'react';
import {Alert} from 'antd';
import {CloudSyncOutlined} from '@ant-design/icons';
import {isOffline, subscribe} from '../../utils/connectivity';
import {
    discardAttention, getAttention, getSnapshot, pendingCount, retryAttention,
} from '../../utils/offlineOrderQueue';
import {requestSync} from '../../utils/offlineOrderSync';
import {useLanguage} from '../../i18n/LanguageContext';
import IosIcon from '../Common/IosIcon';
import {attentionRowView} from './offlineSyncView';
import './OfflineBanner.css';

const NONE = [];

const sameEntries = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Polls the queue while an order is open so the pending count and the parked
// lines stay fresh without threading queue events through the component
// tree. `attention` keeps its identity between polls that find no change, so
// a steady queue does not re-render every 1.5 s.
export const useOfflineStatus = (orderId) => {
    const [offline, setOffline] = useState(isOffline());
    const [pending, setPending] = useState(orderId ? pendingCount(orderId) : 0);
    const [attention, setAttention] = useState(orderId ? getAttention(orderId) : NONE);

    useEffect(() => subscribe(setOffline), []);

    const refresh = useCallback(() => {
        setPending(orderId ? pendingCount(orderId) : 0);
        const next = orderId ? getAttention(orderId) : NONE;
        setAttention((prev) => (sameEntries(prev, next) ? prev : next));
    }, [orderId]);

    useEffect(() => {
        refresh();
        if (!orderId) return undefined;
        const timer = setInterval(refresh, 1500);
        return () => clearInterval(timer);
    }, [orderId, offline, refresh]);

    return {offline, pending, attention, refresh};
};

// A line the sync engine could not replay on its own. Retry and Discard are
// instant, like the cart's own delete: the tap on a named row is the
// deliberate gesture.
const AttentionRow = ({entry, orderId, snapshot, onRetry, onDiscard}) => {
    const {t} = useLanguage();
    const view = attentionRowView(entry, {orderId, snapshot}, t);
    return (
        <li className="if-row m-offline-attention-row">
            <span className="if-row-thumb is-warning" aria-hidden="true">
                <IosIcon name="warn" size={22}/>
            </span>
            <span className="if-row-main">
                <span className="if-row-title">{view.title}</span>
                {view.meta && <span className="if-row-subtitle">{view.meta}</span>}
                <span className="if-row-subtitle m-offline-attention-reason">{view.reason}</span>
                <span className="if-row-subtitle">{view.context}</span>
                <span className="m-offline-attention-actions">
                    <button
                        type="button"
                        className="if-pill is-on"
                        aria-label={`${t.offlineRetryNow}: ${view.title}`}
                        onClick={() => onRetry(entry.op.id)}
                    >
                        {t.offlineRetryNow}
                    </button>
                    <button
                        type="button"
                        className="if-pill m-offline-attention-discard"
                        aria-label={`${t.offlineDiscard}: ${view.title}`}
                        onClick={() => onDiscard(entry.op.id)}
                    >
                        {t.offlineDiscard}
                    </button>
                </span>
            </span>
        </li>
    );
};

// `onDiscard(orderId)` runs once a parked line is discarded, for the page to
// read the order again (see handleDiscard).
const OfflineBanner = ({orderId, onDiscard}) => {
    const {t} = useLanguage();
    const {offline, pending, attention, refresh} = useOfflineStatus(orderId);
    const showStatus = offline || pending > 0;
    if (!showStatus && attention.length === 0) return null;

    const handleRetry = (opId) => {
        retryAttention(orderId, opId);
        refresh();
        requestSync();
    };

    // A parked line holds back the changes queued behind it that depend on
    // it (offlineOrderQueue.js mustFollow); with it gone, they can go now.
    // The cart can also still show what the line did to the order: a line
    // parks without the order being read back when the drain cannot read it
    // or its closing read fails, and nothing else would read it again.
    const handleDiscard = (opId) => {
        discardAttention(orderId, opId);
        refresh();
        if (pendingCount(orderId) > 0) requestSync();
        if (onDiscard) onDiscard(orderId);
    };

    const snapshot = attention.length > 0 ? getSnapshot(orderId) : null;

    return (
        <>
            {showStatus && (
                <Alert
                    banner
                    type="warning"
                    icon={<CloudSyncOutlined/>}
                    message={offline ? t.offlineBanner : t.offlinePendingCount(pending)}
                    description={offline && pending > 0 ? t.offlinePendingCount(pending) : null}
                />
            )}
            {attention.length > 0 && (
                <section aria-label={t.offlineAttentionTitle}>
                    <h4 className="if-section-header">{t.offlineAttentionTitle}</h4>
                    <ul className="if-group">
                        {attention.map((entry) => (
                            <AttentionRow
                                key={entry.op.id}
                                entry={entry}
                                orderId={orderId}
                                snapshot={snapshot}
                                onRetry={handleRetry}
                                onDiscard={handleDiscard}
                            />
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
};

export default OfflineBanner;
