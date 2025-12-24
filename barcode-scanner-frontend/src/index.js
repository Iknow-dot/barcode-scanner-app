import 'antd/dist/reset.css';
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

console.log(process.env.REACT_APP_PUBLIC_POSTHOG_KEY);

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

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();