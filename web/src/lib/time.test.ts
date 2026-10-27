import { describe, expect, it } from "vitest";
import { formatNeededBy } from "./time";

describe("formatNeededBy", () => {
  it("shows the date with its weekday, and the time when there is one", () => {
    expect(formatNeededBy({ needed_on: "2026-11-03", needed_by: "06:30:00" })).toBe("יום שלישי, 3.11 · 06:30");
    expect(formatNeededBy({ needed_on: "2026-11-03", needed_by: null })).toBe("יום שלישי, 3.11");
  });
});
