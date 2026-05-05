// Service Worker for PWA offline support

const CACHE_NAME = 'nrd-pedidos-v3-' + Date.now();
// Get base path from service worker location
const getBasePath = () => {
  const path = self.location.pathname;
  return path.substring(0, path.lastIndexOf('/') + 1);
};
const BASE_PATH = getBasePath();

// Install event - skip waiting to activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete all old caches
          if (cacheName.startsWith('nrd-pedidos-')) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Force all clients to reload
      return self.clients.claim();
    })
  );
  return self.clients.claim();
});

// Fetch event - Network first strategy for better updates
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip non-HTTP/HTTPS schemes (chrome-extension, data, blob, etc.)
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Skip service worker file itself - always fetch from network
  if (event.request.url.includes('service-worker.js')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Skip Firebase CDN - always fetch from network
  if (event.request.url.includes('firebasejs') || event.request.url.includes('gstatic.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network first strategy for HTML, JS, and CSS files
  // Always fetch from network for files with version parameters or dynamic content
  if (event.request.url.includes('.html') || 
      event.request.url.includes('.js') || 
      event.request.url.includes('.css')) {
    
    // If URL has version parameter, always fetch from network and don't cache
    if (event.request.url.includes('?v=') || event.request.url.includes('&v=')) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            return response;
          })
          .catch(() => {
            // If network fails, try cache without version parameter
            const urlWithoutVersion = event.request.url.split('?')[0].split('&')[0];
            return caches.match(urlWithoutVersion).then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // If both fail and it's a navigation request, return cached index.html
              if (event.request.mode === 'navigate') {
                return caches.match(BASE_PATH + 'index.html');
              }
            });
          })
      );
      return;
    }
    
    // For files without version, use network first but cache for offline
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          // Don't cache HTML, JS, CSS files - always fetch fresh
          return response;
        })
        .catch(() => {
          // If network fails, try cache
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If both fail and it's a navigation request, return cached index.html
            if (event.request.mode === 'navigate') {
              return caches.match(BASE_PATH + 'index.html');
            }
          });
        })
    );
    return;
  }

  // For other resources, try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache).catch((err) => {
                console.warn('Failed to cache:', event.request.url, err);
              });
            }).catch((err) => {
              console.warn('Failed to open cache:', err);
            });
          }
          return response;
        });
      })
  );
});

