// Last-known data, so screens render at once and refresh in the background
// (and still show something with no signal). Storage can be full, blocked
// or cleared at any time, so every access is allowed to fail.
//
// Each value records when it was saved. Copies not refreshed for
// MAX_AGE_MS are pruned at startup: a screen nobody opened for a month is
// not needed offline. This is separate from the server's retention period.

// Staging and production are served from the same origin, so they share
// storage. Keys name the Supabase project they came from, so neither shows
// the other's rows or clears them on sign-out.
const PROJECT = new URL(import.meta.env.VITE_SUPABASE_URL ?? "http://local").hostname.split(".")[0];
export const PREFIX = `cache-v3:${PROJECT}:`;
const OLD_PREFIXES = ["cache-v1:", "cache-v2:"];
export const MAX_AGE_MS = 30 * 86_400_000;

interface Saved<T> { savedAt: number; value: T }

export const isFresh = (savedAt: number, now = Date.now()) => now - savedAt <= MAX_AGE_MS;

export function readCache<T>(key: string): T | null {
  if (pendingWrites.has(key)) return pendingWrites.get(key) as T;
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as Saved<T>).value : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Not cached this time; the next refresh tries again.
  }
}

// Live lists change with every Realtime event, and saving one is a
// JSON.stringify of every row on the main thread. Those saves wait a few
// seconds, so a burst of changes saves once, and happen at once when the
// app goes to the background, where it may be closed.
export const SAVE_DELAY_MS = 3000;
const pendingWrites = new Map<string, unknown>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function flushCacheWrites(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  pendingWrites.forEach((value, key) => writeCache(key, value));
  pendingWrites.clear();
}

/** writeCache, delayed by up to SAVE_DELAY_MS; a newer value for the key replaces a waiting one. */
export function writeCacheSoon(key: string, value: unknown): void {
  pendingWrites.set(key, value);
  saveTimer ??= setTimeout(flushCacheWrites, SAVE_DELAY_MS);
}

document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushCacheWrites());

const cacheKeys = () => Object.keys(localStorage).filter((k) => [PREFIX, ...OLD_PREFIXES].some((p) => k.startsWith(p)));

/** Drops copies older than MAX_AGE_MS, and any left in an older format. Run at startup. */
export function pruneCaches(now = Date.now()): void {
  try {
    for (const key of cacheKeys()) {
      if (!key.startsWith(PREFIX)) {
        localStorage.removeItem(key);
        continue;
      }
      try {
        const { savedAt } = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<Saved<unknown>>;
        if (typeof savedAt !== "number" || !isFresh(savedAt, now)) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage unavailable: nothing to prune.
  }
}

/** Drops every cached value. Used on sign-out, so a shared phone keeps nothing. */
export function clearAllCaches(): void {
  pendingWrites.clear();
  try {
    cacheKeys().forEach((k) => localStorage.removeItem(k));
  } catch {
    // Nothing to clear.
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    // Nothing to clear.
  }
}
