import { describe, expect, it } from "vitest";
import { formatEventDate, formatNeededFor } from "./dates.ts";

describe("event dates", () => {
  it("shows the weekday with the date", () => {
    expect(formatEventDate("2026-11-03")).toBe("יום שלישי, 3.11");
    expect(formatEventDate("2026-11-06")).toBe("יום שישי, 6.11");
  });

  it("combines date and time, or shows whichever exists", () => {
    expect(formatNeededFor("2026-11-03", "06:30:00")).toBe("יום שלישי, 3.11 · 06:30");
    expect(formatNeededFor("2026-11-03", null)).toBe("יום שלישי, 3.11");
    expect(formatNeededFor(null, "22:00:00")).toBe("22:00");
    expect(formatNeededFor(null, null)).toBe("");
  });
});
