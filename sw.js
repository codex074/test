const CACHE_NAME = 'leave-opd-cache-v2'; // อัปเดตเวอร์ชัน Cache

// รายการไฟล์ที่จำเป็นสำหรับแอป (Core App Shell) + CDN
const urlsToCache = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'holidays.json',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'apple-touch-icon.png',
  'favicon.ico',
  // === CDN Assets ===
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/css/tom-select.css',
  'https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/js/tom-select.complete.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;600;700&display=swap'
];

// 1. ติดตั้ง Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        // เราต้องใช้ { mode: 'no-cors' } เพื่อ cache ไฟล์จาก CDN
        // ไม่เช่นนั้น request จะล้มเหลวเพราะ CORS
        const requests = urlsToCache.map(url => {
          return new Request(url, { mode: 'no-cors' });
        });
        return cache.addAll(requests);
      })
      .catch(err => {
        console.warn('Cache addAll (URLs) failed, trying individually:', err);
        // ถ้า addAll ล้มเหลว (เช่น CDN ตัวใดตัวหนึ่งล่ม) ให้ลอง cache ทีละไฟล์
        return caches.open(CACHE_NAME).then(cache => {
           urlsToCache.forEach(url => {
               cache.add(new Request(url, { mode: 'no-cors' })).catch(err => {
                   console.warn(`Failed to cache ${url}`, err);
               });
           });
        });
      })
  );
  self.skipWaiting();
});

// 2. จัดการ Fetch Requests (กลยุทธ์แบบผสม)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Network Only: Firebase (ต้อง Online เสมอ)
  if (url.hostname.includes('firebase') || url.hostname.includes('firestore')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Stale-While-Revalidate: CDN และ Google Fonts
  // (โหลดจาก Cache ก่อนทันที แล้วค่อยอัปเดต Cache ในพื้นหลัง)
  if (url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('cdn.tailwindcss.com')) {

    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          // Fetch จาก network เสมอในพื้นหลัง เพื่ออัปเดต cache
          const fetchPromise = fetch(event.request).then(networkResponse => {
            // ตรวจสอบ networkResponse ก่อน cache (status 0 คือ opaque response จาก no-cors)
            if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
                 cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(err => {
              // ถ้า fetch ล้มเหลว (เช่น offline) และมี cache อยู่ ก็ไม่เป็นไร
              if(cachedResponse) {
                  return cachedResponse;
              }
              // ถ้าไม่มี cache และ fetch ล้มเหลว ก็จะ error (ซึ่งเป็นปกติ)
          });

          // ส่ง cache กลับไปก่อนทันที (ถ้ามี)
          // หรือถ้าไม่มี cache (ติดตั้งครั้งแรกตอน offline) ก็รอ network
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 3. Cache-First (Default): Local App Shell (index.html, style.css, etc.)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // ถ้าเจอใน Cache ให้ส่ง response จาก Cache กลับไปเลย
        if (response) {
          return response;
        }
        // ถ้าไม่เจอใน Cache ให้ไปโหลดจาก Network
        return fetch(event.request);
      })
  );
});

// 3. จัดการ Activate Event (ลบ Cache เก่า)
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME]; // ระบุชื่อ Cache ปัจจุบัน (v2)
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // ถ้า cacheName ไม่อยู่ใน whitelist (เช่น v1) ให้ลบทิ้ง
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

