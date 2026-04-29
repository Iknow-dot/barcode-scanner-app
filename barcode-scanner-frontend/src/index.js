import 'antd/dist/reset.css';
import 'leaflet/dist/leaflet.css';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';
import posthog from 'posthog-js';
import {PostHogProvider} from 'posthog-js/react';


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