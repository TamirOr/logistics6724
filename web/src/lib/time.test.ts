import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNeededBy } from "./time";

afterEach(() => vi.useRealTimers());

describe("formatNeededBy", () => {
  it("shows the time alone when it falls today", () => {
    vi.useFakeTimers({ now: new Date("2026-10-27T08:00:00Z") });
    expect(formatNeededBy({ needed_on: null, needed_by: "22:00:00", needed_at: "2026-10-27T19:00:00Z" })).toBe("22:00");
  });

  it("marks tomorrow when the time already passed when the event opened", () => {
    vi.useFakeTimers({ now: new Date("2026-10-27T20:00:00Z") });
    expect(formatNeededBy({ needed_on: null, needed_by: "06:00:00", needed_at: "2026-10-28T03:00:00Z" })).toBe("מחר 06:00");
  });

  it("shows the date with its weekday when the event has one", () => {
    vi.useFakeTimers({ now: new Date("2026-10-27T08:00:00Z") });
    expect(formatNeededBy({ needed_on: "2026-11-03", needed_by: "06:30:00", needed_at: "2026-11-03T04:30:00Z" }))
      .toBe("יום שלישי, 3.11 · 06:30");
  });

  it("is empty without a time", () => {
    expect(formatNeededBy({ needed_on: null, needed_by: null, needed_at: null })).toBe("");
  });
});
