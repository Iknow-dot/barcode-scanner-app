import React, {useEffect, useState} from 'react';
import {Alert} from 'antd';
import {CloudSyncOutlined} from '@ant-design/icons';
import {isOffline, subscribe} from '../../utils/connectivity';
import {pendingCount} from '../../utils/offlineOrderQueue';
import {useLanguage} from '../../i18n/LanguageContext';

// Polls the queue while offline so the pending count stays fresh without
// threading queue events through the component tree.
export const useOfflineStatus = (orderId) => {
    const [offline, setOffline] = useState(isOffline());
    const [pending, setPending] = useState(orderId ? pendingCount(orderId) : 0);

    useEffect(() => subscribe(setOffline), []);

    useEffect(() => {
        if (!orderId) { setPending(0); return undefined; }
        setPending(pendingCount(orderId));
        const timer = setInterval(() => setPending(pendingCount(orderId)), 1500);
        return () => clearInterval(timer);
    }, [orderId, offline]);

    return {offline, pending};
};

const OfflineBanner = ({orderId}) => {
    const {t} = useLanguage();
    const {offline, pending} = useOfflineStatus(orderId);
    if (!offline && pending === 0) return null;
    return (
        <Alert
            banner
            type="warning"
            icon={<CloudSyncOutlined/>}
            message={offline ? t.offlineBanner : t.offlinePendingCount(pending)}
            description={offline && pending > 0 ? t.offlinePendingCount(pending) : null}
        />
    );
};

export default OfflineBanner;
