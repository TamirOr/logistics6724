import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCache, readCache, writeCache } from "./cache";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("cache", () => {
  it("round-trips a value and clears it", () => {
    writeCache("home:u1", { events: [1, 2] });
    expect(readCache("home:u1")).toEqual({ events: [1, 2] });
    clearCache("home:u1");
    expect(readCache("home:u1")).toBeNull();
  });

  it("never throws when storage fails or holds junk", () => {
    localStorage.setItem("cache-v1:bad", "{not json");
    expect(readCache("bad")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => writeCache("k", 1)).not.toThrow();
  });
});
