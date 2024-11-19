// serviceWorkerRegistration.js
export const registerServiceWorker = async () => {
  console.log("niniko");
    if (process.env.NODE_ENV === 'production') {
      try {
        // Register service worker for production
        const swRegistration = await navigator.serviceWorker.register('/service-worker.js');
  
        swRegistration.addEventListener('updatefound', () => {
          const installingWorker = swRegistration.installing;
          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
              console.log("2");
              if (navigator.serviceWorker.controller) {
                console.log("3");
                alert('New version available! Refreshing the page...');
                localStorage.clear(); // Clears all items in localStorage
                sessionStorage.clear(); // Clears all items in sessionStorage
                window.location.href = window.location.href + '?cacheBust=' + new Date().getTime();  
              }
            }
          });
        });
      } catch (error) {
        console.error("Error during service worker registration:", error);
      }
    }
  };
