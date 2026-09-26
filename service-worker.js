const CACHE_NAME = 'bagantara-driver-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/firebase-config.js',
  './js/auth.js',
  './js/dashboard.js',
  './js/gps-engine.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// 1. Proses Instalasi Mesin PWA
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Sistem latar belakang menyerap cache...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. Pembersihan Cache Lama saat ada pembaruan
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Memusnahkan cache usang:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Strategi Network-First dengan Fallback Offline
self.addEventListener('fetch', (event) => {
  // Abaikan request ke Firebase atau API eksternal agar tidak bentrok
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('firebasedatabase.app')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          // Update cache dengan versi terbaru dari jaringan
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // Jika offline atau jaringan mati, gunakan data dari memori cache
        return caches.match(event.request);
      })
  );
});
