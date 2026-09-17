import React from 'react';
import {Button, ConfigProvider, Result} from 'antd';
import {useLanguage} from '../i18n/LanguageContext';
import {antdTheme} from '../theme/antdTheme';

/**
 * Fallback for Sentry.ErrorBoundary. Rendered inside LanguageProvider so the
 * copy can be translated; a crash in the providers themselves is not covered.
 *
 * The boundary sits above App.js's ConfigProvider (it has to, so it can also
 * catch a crash in the provider tree itself), so by the time this renders
 * there is no theme context left and antd falls back to its own default
 * (blue) palette. Re-wrap a themed ConfigProvider here. `index.js` sets the
 * `dark-theme` body class before the first render and keeps it in sync with
 * the real toggle, so it's the one signal that still reflects the user's
 * mode after everything above this component has unmounted.
 */
const AppErrorFallback = () => {
    const {t} = useLanguage();
    const isDark = typeof document !== 'undefined' && document.body.classList.contains('dark-theme');

    return (
        <ConfigProvider theme={antdTheme(isDark)}>
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
        </ConfigProvider>
    );
};

export default AppErrorFallback;
