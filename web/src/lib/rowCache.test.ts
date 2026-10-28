import { describe, expect, it, vi } from "vitest";
import { MAX_AGE_MS, PREFIX } from "./cache";

vi.mock("./supabase", () => ({ supabase: {} }));

describe("event and item caches", () => {
  it("drop rows not seen within the max age when they load", async () => {
    const now = Date.now();
    localStorage.setItem(`${PREFIX}rows:events`, JSON.stringify({
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

  it("forget a dropped row, in storage too", async () => {
    const { eventCache } = await import("./live");
    eventCache.put([{ id: "gone", name: "נמחק" } as never]);
    eventCache.drop("gone");
    expect(eventCache.get("gone")).toBeUndefined();
    const saved = JSON.parse(localStorage.getItem(`${PREFIX}rows:events`) ?? "{}");
    expect(saved.value.some((r: { row: { id: string } }) => r.row.id === "gone")).toBe(false);
  });
});
