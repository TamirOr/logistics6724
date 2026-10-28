import { describe, expect, it } from "vitest";
import { isOutdated } from "./version";

describe("min_client_version", () => {
  it("blocks builds older than the minimum", () => {
    expect(isOutdated(1_700_000_000, "1700000001")).toBe(true);
  });

  it("lets the minimum build and newer ones write", () => {
    expect(isOutdated(1_700_000_001, "1700000001")).toBe(false);
    expect(isOutdated(1_800_000_000, "1700000001")).toBe(false);
  });

  it("never blocks when unset, unreadable or on a local build", () => {
    expect(isOutdated(1_700_000_000, "0")).toBe(false);
    expect(isOutdated(1_700_000_000, null)).toBe(false);
    expect(isOutdated(1_700_000_000, "not a number")).toBe(false);
    expect(isOutdated(0, "1700000001")).toBe(false);
  });
});
