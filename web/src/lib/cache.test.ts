import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, clearCache, readCache, writeCache } from "./cache";

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

  it("clearAllCaches drops cached values but leaves other storage alone", () => {
    writeCache("profile", { id: "u1" });
    writeCache("requests:list:l1", [1]);
    localStorage.setItem("write-queue-v1:u1", "[]");
    clearAllCaches();
    expect(readCache("profile")).toBeNull();
    expect(readCache("requests:list:l1")).toBeNull();
    expect(localStorage.getItem("write-queue-v1:u1")).toBe("[]");
  });
});
