/* Temporary retirement worker: clear only the old offline-records prototype's cache. */
const LEGACY_CACHE_PREFIX = "habfarms-pwa-shell-";

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(LEGACY_CACHE_PREFIX))
      .map((key) => caches.delete(key)));
    await self.registration.unregister();
  })());
});
