import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, clearCache, MAX_AGE_MS, pruneCaches, readCache, writeCache } from "./cache";

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
    localStorage.setItem("cache-v2:bad", "{not json");
    expect(readCache("bad")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => writeCache("k", 1)).not.toThrow();
  });

  it("clearAllCaches drops cached values but leaves other storage alone", () => {
    writeCache("profile", { id: "u1" });
    writeCache("requests:list:l1", [1]);
    localStorage.setItem("write-queue-v1:u1", "[]");
    clearAllCaches();
    expect(readCache("profile")).toBeNull();
    expect(readCache("requests:list:l1")).toBeNull();
    expect(localStorage.getItem("write-queue-v1:u1")).toBe("[]");
  });

  it("prunes copies older than the max age and any in the old format", () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T00:00:00Z") });
    writeCache("requests:list:old", [1]);
    vi.setSystemTime(new Date("2026-10-27T00:00:00Z"));
    writeCache("requests:list:new", [2]);
    localStorage.setItem("cache-v1:profile", "{}");
    pruneCaches(Date.parse("2026-10-01T00:00:00Z") + MAX_AGE_MS + 1);
    expect(readCache("requests:list:old")).toBeNull();
    expect(readCache("requests:list:new")).toEqual([2]);
    expect(localStorage.getItem("cache-v1:profile")).toBeNull();
    vi.useRealTimers();
  });
});
