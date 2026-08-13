// Minimal service worker. Its only job is to exist with a fetch handler so the app satisfies PWA
// installability. It deliberately does NO caching and never calls respondWith — every request goes
// straight to the network — so it can't serve stale authenticated pages or interfere with sign-in.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // no-op: fall through to the browser's default network handling.
});
