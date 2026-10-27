// Last-known data, so screens render at once and refresh in the background
// (and still show something with no signal). Storage can be full, blocked
// or cleared at any time, so every access is allowed to fail.

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`cache-v1:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(`cache-v1:${key}`, JSON.stringify(value));
  } catch {
    // Not cached this time; the next refresh tries again.
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(`cache-v1:${key}`);
  } catch {
    // Nothing to clear.
  }
}
