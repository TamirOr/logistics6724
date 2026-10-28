// New versions and the minimum version. The service worker installs a new
// build in the background; the app switches to it only when the user taps
// the update banner and no write is waiting, so a running tab never mixes
// old code with a new worker mid-write. Below the server's
// min_client_version the app stops sending writes until it reloads.
import { useEffect, useState, useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { fetchTuning } from "./api";
import { onReturn } from "./foreground";
import { setQueuePaused } from "./queue";
import { APP_BUILT_AT, isOutdated } from "./version";

const CHECK_EVERY_MS = 60 * 60_000;

let updateWaiting = false;
let activate: ((reload?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();

function setUpdateWaiting() {
  updateWaiting = true;
  listeners.forEach((l) => l());
}

/** Registers the service worker and looks for new builds hourly and when the app comes back to the front. */
export function startUpdates() {
  activate = registerSW({
    immediate: true,
    onNeedRefresh: setUpdateWaiting,
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      const check = () => registration.update().catch(() => {});
      setInterval(check, CHECK_EVERY_MS);
      onReturn(check);
    },
  });
}

export const useUpdateWaiting = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => updateWaiting);

/** Switches to the waiting build and reloads, or just reloads when none is waiting. */
export async function applyUpdate() {
  if (updateWaiting && activate) await activate(true);
  else location.reload();
}

const waitUntil = (condition: () => boolean, timeoutMs: number) => new Promise<void>((resolve) => {
  const started = Date.now();
  const poll = () => (condition() || Date.now() - started > timeoutMs ? resolve() : setTimeout(poll, 250));
  poll();
});

/** Fetches the newest build first, for when this one is too old to write. */
export async function reloadToLatest() {
  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.update().catch(() => {});
  await waitUntil(() => updateWaiting, 10_000);
  await applyUpdate();
}

/** The build the service worker serves, or null when there is none. */
export function workerVersion(): Promise<string | null> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(String(e.data));
    };
    worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
  });
}

/**
 * True when the server requires a newer build. Checked once signed in and
 * whenever the app comes back to the front; writes stay on the phone meanwhile.
 */
export function useOutdated(signedIn: boolean): boolean {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    const check = () => fetchTuning("min_client_version", "0")
      .then((min) => setOutdated(isOutdated(APP_BUILT_AT, min)))
      .catch(() => {}); // Offline: keep the last answer.
    check();
    return onReturn(check);
  }, [signedIn]);
  useEffect(() => setQueuePaused(outdated), [outdated]);
  return outdated;
}
