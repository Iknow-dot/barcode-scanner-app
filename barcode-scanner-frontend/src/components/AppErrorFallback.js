import React from 'react';
import {Button, Result} from 'antd';
import {useLanguage} from '../i18n/LanguageContext';

/**
 * Fallback for Sentry.ErrorBoundary. Rendered inside LanguageProvider so the
 * copy can be translated; a crash in the providers themselves is not covered.
 */
const AppErrorFallback = () => {
    const {t} = useLanguage();

    return (
        <Result
            status="error"
            title={t.errorBoundaryTitle}
            subTitle={t.errorBoundarySubtitle}
            extra={
                <Button type="primary" onClick={() => window.location.reload()}>
                    {t.errorBoundaryReload}
                </Button>
            }
        />
    );
};

export default AppErrorFallback;
