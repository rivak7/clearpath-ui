/* eslint-disable no-undef */
importScripts("https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js");

if (self.workbox) {
  workbox.setConfig({ debug: false });
  const { precaching, routing, strategies, expiration, plugins, backgroundSync } = workbox;

  precaching.precacheAndRoute([{"revision":"6dd61322dbaf97e00315fc7e21a133e5","url":"assets/index-c0xFwjc8.css"},{"revision":"9dc2368edbab99a671ed8538992c9821","url":"assets/index-CBz-XDRG.js"},{"revision":"f296e814a2c955d9b2ffa2616aff88ac","url":"assets/maplibre-gl-wPi1aodi.js"},{"revision":"eb3a5b624a04ca6cb4ca7ff8caa965cc","url":"index.html"}] || [], {
    cleanURLs: true
  });

  routing.registerRoute(
    ({ url }) => url.origin === "https://tile.openstreetmap.org",
    new strategies.CacheFirst({
      cacheName: "clearpath-tiles",
      matchOptions: { ignoreVary: true },
      plugins: [
        new expiration.ExpirationPlugin({
          maxEntries: 5,
          maxAgeSeconds: 60 * 60 * 24 * 3
        })
      ]
    })
  );

  routing.registerRoute(
    ({ url }) => url.origin === self.location.origin && url.pathname.startsWith("/api/"),
    new strategies.NetworkFirst({
      cacheName: "clearpath-api",
      networkTimeoutSeconds: 3,
      plugins: [
        new expiration.ExpirationPlugin({
          maxEntries: 5,
          maxAgeSeconds: 60 * 60 * 24
        })
      ]
    }),
    "GET"
  );

  routing.registerRoute(
    ({ request }) => request.destination === "style",
    new strategies.StaleWhileRevalidate({
      cacheName: "clearpath-styles",
      plugins: [
        new expiration.ExpirationPlugin({
          maxEntries: 5,
          maxAgeSeconds: 60 * 60 * 24 * 14
        })
      ]
    })
  );

  const queue = new backgroundSync.BackgroundSyncPlugin("clearpath-sync-queue", {
    maxRetentionTime: 60 * 24
  });

  routing.registerRoute(
    ({ request }) =>
      request.method === "POST" &&
      request.url.startsWith(`${self.location.origin}/api/`) &&
      (request.url.endsWith("/confirm") || request.url.endsWith("/correct")),
    new strategies.NetworkOnly({
      plugins: [queue]
    }),
    "POST"
  );

  self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  });

  self.addEventListener("activate", () => {
    clients.claim();
  });
}
