import { describe, expect, it } from "vitest";
import { authorized, safeEqual } from "./secrets.ts";

const withSecret = (value?: string) => ({ headers: new Headers(value === undefined ? {} : { "x-cron-secret": value }) });

describe("cron secret", () => {
  it("compares strings exactly", () => {
    expect(safeEqual("s3cr3t", "s3cr3t")).toBe(true);
    expect(safeEqual("s3cr3t", "s3cr3x")).toBe(false);
    expect(safeEqual("s3cr3t", "s3cr3t-longer")).toBe(false);
    expect(safeEqual("", "s3cr3t")).toBe(false);
    expect(safeEqual("s3cr3t", "")).toBe(false);
  });

  it("accepts only the configured secret", () => {
    expect(authorized(withSecret("s3cr3t"), "s3cr3t")).toBe(true);
  });

  it("refuses a wrong, missing or unconfigured secret (the 401 path)", () => {
    expect(authorized(withSecret("wrong"), "s3cr3t")).toBe(false);
    expect(authorized(withSecret(), "s3cr3t")).toBe(false);
    expect(authorized(withSecret(""), undefined)).toBe(false);
    expect(authorized(withSecret("anything"), undefined)).toBe(false);
  });
});
