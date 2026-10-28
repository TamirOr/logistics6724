import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, sentryHost } from "./csp";

describe("content security policy", () => {
  it("allows only self, the Supabase project and Sentry's ingest host", () => {
    const policy = contentSecurityPolicy("https://abc.supabase.co", "https://key@o1.ingest.sentry.io/2");
    expect(policy).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co https://o1.ingest.sentry.io");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe/);
  });

  it("leaves Sentry out when there is no DSN", () => {
    expect(contentSecurityPolicy("https://abc.supabase.co")).not.toContain("sentry");
    expect(sentryHost("not a url")).toBeNull();
  });
});
