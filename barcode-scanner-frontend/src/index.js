import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const registerServiceWorker = async () => {
  if (process.env.NODE_ENV === 'production') {
    try {
      // Register service worker for production
      const swRegistration = await navigator.serviceWorker.register('/service-worker.js');
      
      swRegistration.addEventListener('updatefound', () => {
        const installingWorker = swRegistration.installing;
        
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              alert('New version available! Refreshing the page...');
              window.location.reload();
            }
          }
        });
      });
    } catch (error) {
      console.error("Error during service worker registration:", error);
    }
  }
};

registerServiceWorker(); // Call the async function to register the service worker


// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
