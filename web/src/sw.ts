/// <reference lib="webworker" />
// Service worker: caches the app shell so it opens with no signal, shows
// push notifications, and opens the right screen when one is tapped.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title ?? "", {
    body: data.body,
    tag: data.tag,
    lang: "he",
    dir: "rtl",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url ?? "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows[0];
    if (open) {
      await open.focus();
      return open.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});
