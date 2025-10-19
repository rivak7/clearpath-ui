/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

declare let self: ServiceWorkerGlobalScope;

clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const navigationHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute((options) => {
  if (options.request.mode === 'navigate') {
    return navigationHandler(options);
  }
  return navigationHandler(options);
});
registerRoute(navigationRoute);

registerRoute(
  ({ url }) => url.hostname === 'tile.openstreetmap.org',
  new CacheFirst({
    cacheName: 'clearpath-tiles',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 })
    ]
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/entrance'),
  new NetworkFirst({
    cacheName: 'clearpath-entrances',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 })]
  })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/geocode/'),
  new StaleWhileRevalidate({ cacheName: 'clearpath-geocode' })
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/ping') || url.pathname.startsWith('/api/health'),
  new StaleWhileRevalidate({ cacheName: 'clearpath-misc' })
);

const backgroundSyncPlugin = new BackgroundSyncPlugin('clearpath-post-queue', {
  maxRetentionTime: 24 * 60
});

registerRoute(
  ({ url, request }) =>
    request.method === 'POST' &&
    (url.pathname.startsWith('/api/confirm') || url.pathname.startsWith('/api/correct')),
  new NetworkOnly({ plugins: [backgroundSyncPlugin] }),
  'POST'
);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
