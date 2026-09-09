import 'antd/dist/reset.css';
import 'leaflet/dist/leaflet.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';
import posthog from 'posthog-js';
import {PostHogProvider} from 'posthog-js/react';
import {registerServiceWorker} from './components/serviceWorkerRegistration';
import * as Sentry from '@sentry/react';
import {scrubEvent} from './observability/scrub';


// Swallow the benign ResizeObserver loop warning that AntD + TipTap
// trigger occasionally. The browser self-recovers on the next frame —
// CRA's dev error overlay just escalates it to a fatal error.
const _RESIZE_OBSERVER_LOOP_RE = /^ResizeObserver loop/;
window.addEventListener('error', (e) => {
  if (_RESIZE_OBSERVER_LOOP_RE.test(e.message || '')) {
    e.stopImmediatePropagation();
  }
});


// Absent DSN means no client at all, so local dev and `npm test` stay silent.
const SENTRY_DSN = process.env.REACT_APP_SENTRY_DSN;
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.REACT_APP_SENTRY_ENVIRONMENT || 'production',
        release: process.env.REACT_APP_SENTRY_RELEASE || undefined,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: Number(process.env.REACT_APP_SENTRY_TRACES_SAMPLE_RATE || 0.05),
        // Scoped to our own API so trace headers never reach Photon or RS.ge.
        tracePropagationTargets: [process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000'],
        // @sentry/react v10 deprecated sendDefaultPii for dataCollection. The
        // backend is on sentry-sdk 2.x, where send_default_pii is still the
        // live option — the two configs look different because the SDK
        // versions differ, not because the intent does. Do not "fix" this.
        dataCollection: {
            userInfo: false,
            httpBodies: [],
            genAI: {inputs: false, outputs: false},
        },
        beforeSend: scrubEvent,
    });
}


posthog.init(process.env.REACT_APP_PUBLIC_POSTHOG_KEY, {
  api_host: process.env.REACT_APP_PUBLIC_POSTHOG_HOST,
  defaults: '2025-12-24',
});


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