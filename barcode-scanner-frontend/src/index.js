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


// Swallow the benign ResizeObserver loop warning that AntD + TipTap
// trigger occasionally. The browser self-recovers on the next frame —
// CRA's dev error overlay just escalates it to a fatal error.
const _RESIZE_OBSERVER_LOOP_RE = /^ResizeObserver loop/;
window.addEventListener('error', (e) => {
  if (_RESIZE_OBSERVER_LOOP_RE.test(e.message || '')) {
    e.stopImmediatePropagation();
  }
});


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