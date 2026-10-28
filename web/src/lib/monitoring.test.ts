import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { createRateLimiter, errorKey, pathOnly, scrubBreadcrumb } from "./monitoring";

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
    expect(scrubBreadcrumb({ category: "ui.click", message: "button" })).toEqual({ category: "ui.click", message: "button" });
  });

  it("keeps sign-in tokens in a link's fragment out of reports", () => {
    const landing = "https://x.github.io/app/#access_token=eyJ.secret&refresh_token=r&type=magiclink";
    expect(pathOnly(landing)).toBe("https://x.github.io/app/");
    expect(pathOnly("/app/?code=abc#x")).toBe("/app/");
    const crumb = scrubBreadcrumb({ category: "navigation", data: { from: landing, to: "/app/events/1?x=1" } });
    expect(crumb?.data).toEqual({ from: "https://x.github.io/app/", to: "/app/events/1" });
  });
});
