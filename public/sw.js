self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      // Ignore cache cleanup errors during SW retirement.
    }

    await self.clients.claim();
    await self.registration.unregister();
  })());
});

self.addEventListener('fetch', () => {
  // Intentionally empty. This worker only exists to retire old cached SW installs.
});
