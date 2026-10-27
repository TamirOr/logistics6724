// Last-known data, so screens render at once and refresh in the background
// (and still show something with no signal). Storage can be full, blocked
// or cleared at any time, so every access is allowed to fail.
//
// Each value records when it was saved. Copies not refreshed for
// MAX_AGE_MS are pruned at startup: a screen nobody opened for a month is
// not needed offline. This is separate from the server's retention period.

const PREFIX = "cache-v2:";
const OLD_PREFIXES = ["cache-v1:"];
export const MAX_AGE_MS = 30 * 86_400_000;

interface Saved<T> { savedAt: number; value: T }

export const isFresh = (savedAt: number, now = Date.now()) => now - savedAt <= MAX_AGE_MS;

export function readCache<T>(key: string): T | null {
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
