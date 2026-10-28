/// <reference lib="webworker" />
// Service worker: caches the app shell so it opens with no signal, shows
// push notifications, and opens the right screen when one is tapped. A new
// version waits until the app asks it to take over (see lib/appUpdate.ts).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { openFromNotification } from "./lib/notificationClick";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// Staging lives under the production app's path (/<repo>/staging/) with its
// own worker; the production worker must not answer for it.
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`), {
  denylist: [new RegExp(`^${import.meta.env.BASE_URL}staging/`)],
}));

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  // The diagnostics screen shows which build the worker serves.
  if (event.data?.type === "GET_VERSION") event.ports[0]?.postMessage(import.meta.env.VITE_APP_VERSION || "dev");
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title ?? "", {
    body: data.body,
    tag: data.tag,
    lang: "he",
    dir: "rtl",
    icon: new URL("icon-192.png", self.registration.scope).href,
    badge: new URL("icon-192.png", self.registration.scope).href,
    data: { url: data.url ?? "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Notification URLs are app paths like /events/<id>; the app may live
  // under a sub-path, so resolve them against the service worker scope.
  const path = String(event.notification.data?.url ?? "/").replace(/^\//, "");
  const url = new URL(path, self.registration.scope).href;
  event.waitUntil(openFromNotification(self.clients, url));
});
