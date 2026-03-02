import { useCallback } from 'react';
import { notification } from 'antd';

/**
 * Custom hook that wraps Ant Design's notification API with
 * convenience methods for success, error, warning, and info.
 *
 * Usage:
 *   const { notify, contextHolder } = useAppNotification();
 *   notify.success('წარმატება', 'ოპერაცია წარმატებით შესრულდა');
 *   notify.error('შეცდომა', 'რაღაც შეცდომა მოხდა');
 *
 * Don't forget to render {contextHolder} in your JSX.
 */
const useAppNotification = () => {
    const [notificationApi, contextHolder] = notification.useNotification();

    const openNotification = useCallback((type, message, description) => {
        notificationApi[type]({
            message,
            description,
            showProgress: true,
            pauseOnHover: true,
        });
    }, [notificationApi]);

    const notify = {
        success: useCallback((message, description) =>
            openNotification('success', message, description), [openNotification]),
        error: useCallback((message, description) =>
            openNotification('error', message, description), [openNotification]),
        warning: useCallback((message, description) =>
            openNotification('warning', message, description), [openNotification]),
        info: useCallback((message, description) =>
            openNotification('info', message, description), [openNotification]),
    };

    return { notify, contextHolder };
};

export default useAppNotification;
