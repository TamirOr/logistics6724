import { describe, expect, it, vi } from "vitest";
import { MAX_AGE_MS } from "./cache";

vi.mock("./supabase", () => ({ supabase: {} }));

describe("event and item caches", () => {
  it("drop rows not seen within the max age when they load", async () => {
    const now = Date.now();
    localStorage.setItem("cache-v2:rows:events", JSON.stringify({
      savedAt: now,
      value: [
        { row: { id: "old", name: "ישן" }, at: now - MAX_AGE_MS - 1 },
        { row: { id: "recent", name: "חדש" }, at: now - 1000 },
      ],
    }));
    const { eventCache } = await import("./live");
    expect(eventCache.get("old")).toBeUndefined();
    expect(eventCache.get("recent")?.name).toBe("חדש");
  });
});
