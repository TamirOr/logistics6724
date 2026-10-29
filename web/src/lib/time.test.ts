import { describe, expect, it } from "vitest";
import { formatNeededBy, formatWrittenAt } from "./time";

describe("formatNeededBy", () => {
  it("shows the date with its weekday, and the time when there is one", () => {
    expect(formatNeededBy({ needed_on: "2026-11-03", needed_by: "06:30:00" })).toBe("יום שלישי, 3.11 · 06:30");
    expect(formatNeededBy({ needed_on: "2026-11-03", needed_by: null })).toBe("יום שלישי, 3.11");
  });
});

describe("formatWrittenAt", () => {
  const now = new Date("2026-11-03T12:00:00Z");

  it("shows only the time, in Israel, for today", () => {
    expect(formatWrittenAt("2026-11-03T11:05:00Z", now)).toBe("13:05");
  });

  it("adds the day for an earlier day", () => {
    expect(formatWrittenAt("2026-11-02T06:30:00Z", now)).toBe("2.11 08:30");
  });
});
