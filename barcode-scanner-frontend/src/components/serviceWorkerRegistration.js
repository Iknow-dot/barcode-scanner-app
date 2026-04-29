// Register the service worker that ships in /public/service-worker.js.
// Runs only in production builds; the dev server doesn't serve a SW.
export const registerServiceWorker = () => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/service-worker.js')
            .catch((err) => console.warn('Service worker registration failed:', err));
    });
};
