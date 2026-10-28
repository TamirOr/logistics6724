import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { createRateLimiter, errorKey, scrubBreadcrumb } from "./monitoring";

describe("error reporting", () => {
  it("sends the same error at most once a minute", () => {
    let now = 0;
    const allow = createRateLimiter(60_000, () => now);
    expect(allow("TypeError: x")).toBe(true);
    now = 30_000;
    expect(allow("TypeError: x")).toBe(false);
    expect(allow("TypeError: y")).toBe(true);
    now = 60_000;
    expect(allow("TypeError: x")).toBe(true);
  });

  it("keys errors by type and message", () => {
    const event = { type: undefined, exception: { values: [{ type: "TypeError", value: "boom" }] } } as ErrorEvent;
    expect(errorKey(event)).toBe("TypeError: boom");
    expect(errorKey({ type: undefined, message: "write rejected" } as ErrorEvent)).toBe("write rejected");
  });

  it("strips request bodies and query strings from network breadcrumbs", () => {
    const crumb = scrubBreadcrumb({
      category: "fetch",
      data: { method: "POST", status_code: 400, url: "https://x.supabase.co/rest/v1/items?name=ilike.*secret*", request_body: "{\"email\":\"a@b.c\"}" },
    });
    expect(crumb?.data).toEqual({ method: "POST", status_code: 400, url: "https://x.supabase.co/rest/v1/items" });
  });

  it("drops console breadcrumbs and keeps others", () => {
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(scrubBreadcrumb({ category: "navigation", data: { to: "/events/1" } })).toMatchObject({ category: "navigation" });
  });
});
