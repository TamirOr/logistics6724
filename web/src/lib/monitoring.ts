// Error reporting to Sentry. Off unless the build has VITE_SENTRY_DSN.
// Reports carry the build, the user id and role, and nothing a user typed:
// no email, name, service number or request contents.
import * as Sentry from "@sentry/react";
import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import type { Mutation } from "./queue";
import { APP_VERSION } from "./version";

const RATE_WINDOW_MS = 60_000;

/** Lets each key through at most once per window, so one broken loop cannot use up the free quota. */
export function createRateLimiter(windowMs = RATE_WINDOW_MS, now = () => Date.now()) {
  const lastSent = new Map<string, number>();
  return (key: string): boolean => {
    const at = now();
    const previous = lastSent.get(key);
    if (previous !== undefined && at - previous < windowMs) return false;
    lastSent.set(key, at);
    return true;
  };
}

/** What makes two reports "the same error". */
export function errorKey(event: ErrorEvent): string {
  const exception = event.exception?.values?.[0];
  return exception ? `${exception.type}: ${exception.value}` : String(event.message ?? event.fingerprint?.join("|") ?? "");
}

const withoutQuery = (url: unknown) => (typeof url === "string" ? url.split("?")[0] : url);

/**
 * Keeps a network breadcrumb's method, status and path only: request
 * bodies and PostgREST query strings can hold what the user typed.
 * Console breadcrumbs are dropped.
 */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === "console") return null;
  if (crumb.category === "fetch" || crumb.category === "xhr") {
    const { method, status_code, url } = crumb.data ?? {};
    return { ...crumb, data: { method, status_code, url: withoutQuery(url) } };
  }
  return crumb;
}

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  const allow = createRateLimiter();
  Sentry.init({
    dsn,
    release: APP_VERSION,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || "production",
    sampleRate: 1.0,
    // Nothing about the user beyond the id set below, and no request data.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: (event) => {
      if (!allow(errorKey(event))) return null;
      if (event.request) event.request = { url: withoutQuery(event.request.url) as string | undefined };
      return event;
    },
  });
}

/** Id and role only. */
export function setMonitoringUser(user: { id: string; role: string } | null) {
  Sentry.setUser(user && { id: user.id });
  Sentry.setTag("role", user?.role ?? "none");
}

/**
 * A write the server refused: most likely the UI and a database rule
 * disagree. Grouped by target and Postgres error code; the message text is
 * left out because it can quote row values.
 */
export function reportRejectedWrite(mutation: Mutation, code: string | undefined) {
  const target = mutation.kind === "rpc" ? mutation.fn : mutation.table;
  Sentry.captureMessage(`write rejected: ${mutation.kind} ${target} (${code ?? "no code"})`, {
    level: "warning",
    tags: { mutation: mutation.kind, target, pg_code: code ?? "none" },
    fingerprint: ["write-rejected", mutation.kind, target, code ?? "none"],
  });
}

export const MonitoredErrorBoundary = Sentry.ErrorBoundary;
