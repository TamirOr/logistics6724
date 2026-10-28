import { describe, expect, it, vi } from "vitest";
import type { ListOverview, LogisticsEvent } from "../lib/types";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const event = (id: string, created_at: string, status: LogisticsEvent["status"] = "open") =>
  ({ id, created_at, status, name: id }) as LogisticsEvent;
const list = (event_id: string) => ({ id: `l-${event_id}`, event_id }) as ListOverview;
const change = (eventType: "INSERT" | "UPDATE" | "DELETE", row: Partial<LogisticsEvent>) =>
  ({ eventType, new: eventType === "DELETE" ? {} : row, old: eventType === "DELETE" ? { id: row.id } : {} }) as never;

describe("applyEventChange", async () => {
  const { applyEventChange } = await import("./useOpenEvents");
  const data = { events: [event("b", "2026-10-02"), event("a", "2026-10-01")], lists: [list("a"), list("b")] };

  it("adds a new open event in date order", () => {
    const next = applyEventChange(data, change("INSERT", event("c", "2026-10-03")));
    expect(next.events.map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect(next.lists).toBe(data.lists);
  });

  it("replaces an edited event in place", () => {
    const next = applyEventChange(data, change("UPDATE", { ...event("a", "2026-10-01"), name: "renamed" }));
    expect(next.events.map((e) => e.name)).toEqual(["b", "renamed"]);
  });

  it("drops a closed event with its lists", () => {
    const next = applyEventChange(data, change("UPDATE", event("a", "2026-10-01", "closed")));
    expect(next.events.map((e) => e.id)).toEqual(["b"]);
    expect(next.lists.map((l) => l.event_id)).toEqual(["b"]);
  });

  it("drops a deleted event with its lists", () => {
    const next = applyEventChange(data, change("DELETE", { id: "b" }));
    expect(next.events.map((e) => e.id)).toEqual(["a"]);
    expect(next.lists.map((l) => l.event_id)).toEqual(["a"]);
  });
});
