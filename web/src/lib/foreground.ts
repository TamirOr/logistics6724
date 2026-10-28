// Coming back to the app. Phones are unlocked dozens of times a shift, and
// each return used to refetch the profile, the minimum version, the service
// worker and every live list on its own. One shared signal fires instead,
// and only after the app was away long enough for something to be stale;
// a quick glance away does not hit the network. Realtime keeps the screen
// current while the app is in front.
export const AWAY_MS = 60_000;

let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
const listeners = new Set<() => void>();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    hiddenAt ??= Date.now();
    return;
  }
  const awayFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;
  if (awayFor >= AWAY_MS) listeners.forEach((l) => l());
});

/** Calls listener when the app returns after AWAY_MS or more in the background. Returns an unsubscribe. */
export function onReturn(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
