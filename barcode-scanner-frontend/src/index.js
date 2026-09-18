import 'antd/dist/reset.css';
import 'leaflet/dist/leaflet.css';
import './theme/tokens.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';
import posthog from 'posthog-js';
import {PostHogProvider} from 'posthog-js/react';
import {registerServiceWorker} from './components/serviceWorkerRegistration';
import * as Sentry from '@sentry/react';
import {buildSentryOptions} from './observability/sentryOptions';
import {initAnalytics} from './observability/analytics';
import {runtimeEnv} from './config/runtimeEnv';


// Swallow the benign ResizeObserver loop warning that AntD + TipTap
// trigger occasionally. The browser self-recovers on the next frame —
// CRA's dev error overlay just escalates it to a fatal error.
const _RESIZE_OBSERVER_LOOP_RE = /^ResizeObserver loop/;
window.addEventListener('error', (e) => {
  if (_RESIZE_OBSERVER_LOOP_RE.test(e.message || '')) {
    e.stopImmediatePropagation();
  }
});


// Build-time REACT_APP_* values with the production image's runtime config
// (public/config.js) layered on top — see ./config/runtimeEnv.
const env = runtimeEnv();

// Absent DSN means no client at all, so local dev and `npm test` stay silent.
// The options themselves live in ./observability/sentryOptions so they can be
// asserted on; this file only decides whether to install them.
if (env.REACT_APP_SENTRY_DSN) {
    Sentry.init(buildSentryOptions(env));
}

// Absent key means PostHog is never initialized and never called.
initAnalytics(env);

// Apply the saved theme before the first render so a dark-mode user never
// sees a light frame; App keeps the class in sync after that.
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-theme');
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <PostHogProvider
            client={posthog}
        >
            <App/>
        </PostHogProvider>
    </React.StrictMode>
);

reportWebVitals();

registerServiceWorker();