// HabitFlow Service Worker v3
// オフラインキャッシュ + プッシュ通知対応

const CACHE_NAME = 'habitflow-v6';

// キャッシュするアセット一覧
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// ===========================
// インストール：アセットをキャッシュ
// ===========================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// ===========================
// アクティベート：古いキャッシュを削除
// ===========================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ===========================
// フェッチ：キャッシュ優先
// ===========================
self.addEventListener('fetch', (event) => {
  // Googleフォントはネットワーク優先
  if (event.request.url.includes('fonts.googleapis.com') ||
      event.request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ===========================
// アプリからのメッセージを受信して通知を表示する
// ===========================
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'SHOW_NOTIFICATION') return;

  const { title, body, icon, badge, tag, data, vibrate } = event.data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body || '',
      icon: icon || './icons/icon-192.png',
      badge: badge || './icons/icon-192.png',
      tag: tag || 'habitflow-reminder',
      data: data || {},
      vibrate: vibrate || [200, 100, 200],
      requireInteraction: false,
      silent: false,
    })
  );
});

// ===========================
// 通知がタップされたらアプリを前面に出す
// ===========================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // すでにアプリが開いているウィンドウがあればフォーカス
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // なければ新しくアプリを開く
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
