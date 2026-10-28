// The Content-Security-Policy the build puts in index.html. GitHub Pages
// cannot send headers, so it goes in a <meta> tag. Imported by vite.config.ts.

/** Sentry's ingest host from a DSN such as https://key@o1.ingest.sentry.io/2. */
export function sentryHost(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).host;
  } catch {
    return null;
  }
}

/** Only the app itself, its Supabase project (API and realtime) and Sentry. */
export function contentSecurityPolicy(supabaseUrl: string, sentryDsn?: string): string {
  const api = new URL(supabaseUrl);
  const sentry = sentryHost(sentryDsn);
  const connect = ["'self'", `https://${api.host}`, `wss://${api.host}`, ...(sentry ? [`https://${sentry}`] : [])];
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React sets style properties from script, which CSP allows; this
    // covers the style attributes some libraries write.
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connect.join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
