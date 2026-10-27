// Last-known data, so screens render at once and refresh in the background
// (and still show something with no signal). Storage can be full, blocked
// or cleared at any time, so every access is allowed to fail.

const PREFIX = "cache-v1:";

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Not cached this time; the next refresh tries again.
  }
}

/** Drops every cached value. Used on sign-out, so a shared phone keeps nothing. */
export function clearAllCaches(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
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
