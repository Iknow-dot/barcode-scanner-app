// App-wide offline flag. The real signal is the API layer (a request
// failing with no HTTP response), with browser online/offline events as
// a secondary source.

let offline = false;
const listeners = new Set();

const setOffline = (value) => {
    if (offline === value) return;
    offline = value;
    listeners.forEach((listener) => listener(offline));
};

export const isOffline = () => offline;
export const markOffline = () => setOffline(true);
export const markOnline = () => setOffline(false);

export const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

if (typeof window !== 'undefined') {
    window.addEventListener('offline', markOffline);
    window.addEventListener('online', markOnline);
}
