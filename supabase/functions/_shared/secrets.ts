// Shared-secret check for the scheduled functions. Plain TypeScript with no
// Deno or npm imports, so the web test suite can run it.

/** Compares in time that depends only on the length, so a caller cannot guess the secret byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ (right[i % Math.max(right.length, 1)] ?? 0);
  return diff === 0;
}

// pg_cron and wake_dispatcher call the functions with app_config.cron_secret.
export function authorized(req: { headers: Headers }, cronSecret: string | undefined): boolean {
  const given = req.headers.get("x-cron-secret");
  return !!cronSecret && given !== null && safeEqual(given, cronSecret);
}
