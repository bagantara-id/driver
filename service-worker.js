const CACHE_NAME = 'bagantara-driver-v2'; // Dinaikkan versinya untuk memaksa pembaruan cache
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
      console.log('Sistem latar belakang menyerap cache operasional...');
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

// 3. Strategi Network-First dengan Fallback Offline (DILINDUNGI DARI CRASH METODE)
self.addEventListener('fetch', (event) => {
  // FILTER MUTLAK: Jangan pernah Cache metode POST, PATCH, PUT, DELETE
  if (event.request.method !== 'GET') return;

  // FILTER MUTLAK: Abaikan lalu lintas Firebase & Cloudinary agar tidak bertabrakan dengan koneksi siluman
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('firebasedatabase.app') ||
      event.request.url.includes('cloudinary.com')) {
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
