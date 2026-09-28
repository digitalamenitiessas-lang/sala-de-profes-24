// Service Worker — Sala de Profes PWA
const CACHE_NAME = 'sala-de-profes-v3';
const OFFLINE_URL = '/offline.html';

// App shell files to pre-cache during install.
// OJO: no incluir '/' — redirige (307) al login y cache.addAll exige 200,
// lo que hacía fallar el install completo y dejaba el SW sin offline.html.
const APP_SHELL = [
  '/offline.html',
];

// Última respuesta de emergencia: nunca devolver undefined a respondWith().
function offlineFallback(request) {
  return caches.match(OFFLINE_URL).then((offline) => {
    if (offline && request.mode === 'navigate') return offline;
    return new Response('Sin conexión', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });
}

// ─── Install ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[SW] Pre-cache falló:', err))
  );
  // Activate immediately without waiting for old SW to finish
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension, etc.
  if (!url.protocol.startsWith('http')) return;

  // ── API calls & Supabase: siempre red directa, sin cachear ──
  // (datos operativos: cachearlos muestra stock/ventas viejos)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) {
    return;
  }

  // ── Static assets (images, fonts, css, js): cache-first ──
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Navigation requests (HTML pages): network-first with offline fallback ──
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || offlineFallback(request))
        )
    );
    return;
  }

  // ── Everything else: network-first ──
  event.respondWith(networkFirst(request));
});

// ─── Strategies ─────────────────────────────────────────

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request)
      .then((response) => {
        // Only cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => offlineFallback(request));
  });
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() =>
      caches.match(request).then((cached) => cached || offlineFallback(request))
    );
}

// ─── Helpers ────────────────────────────────────────────

function isStaticAsset(url) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i.test(
    url.pathname
  );
}

// ─── Push Notifications ──────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192.png',
      badge: data.badge || '/icons/badge-96.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      actions: [{ action: 'open', title: 'Ver' }],
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'Sala de Profes', options)
    );
  } catch {
    // Invalid push data
  }
});

// ─── Notification Click ──────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if available
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.navigate(url);
        return existing.focus();
      }
      // Open new tab
      return self.clients.openWindow(url);
    })
  );
});
