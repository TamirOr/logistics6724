// Web Push registration. On iPhone push works only from the installed
// home-screen app, so the app first shows the install guide there.
import { fetchVapidPublicKey, savePushSubscription } from "./api";

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const needsInstallForPush = () => isIos() && !isStandalone();

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Asks for permission (must run from a tap) and stores the subscription. */
export async function enablePush(userId: string): Promise<NotificationPermission> {
  if (!pushSupported()) return "denied";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const vapidKey = existing ? null : await fetchVapidPublicKey();
  if (!existing && !vapidKey) return "default";
  const sub = existing ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey!),
  }));
  await savePushSubscription(userId, sub.toJSON());
  return permission;
}

/** Re-sends an existing subscription, which browsers may rotate. */
export async function refreshPush(userId: string) {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await savePushSubscription(userId, sub.toJSON());
  else await enablePush(userId);
}
