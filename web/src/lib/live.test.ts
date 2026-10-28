import { describe, expect, it, vi } from "vitest";
import type { QueueEntry } from "./queue";

vi.mock("./supabase", () => ({ supabase: {} }));

const entry = (effects: QueueEntry["effects"]): QueueEntry =>
  ({ id: "e", mutation: { kind: "rpc", fn: "mark_collected", args: {} }, effects, notBefore: 0, tries: 0 });

describe("applyCommitted", async () => {
  const { applyCommitted } = await import("./live");
  const rows = new Map([["a", { id: "a", status: "ready" }], ["b", { id: "b", status: "ready" }]]);

  it("keeps a confirmed RPC's effects on the rows", () => {
    const next = applyCommitted("requests", rows, entry([
      { table: "requests", id: "a", patch: { status: "collected" } },
      { table: "requests", id: "b", remove: true },
    ]));
    expect([...next.values()]).toEqual([{ id: "a", status: "collected" }]);
  });

  it("leaves rows of other tables untouched, without a re-render", () => {
    expect(applyCommitted("events", rows, entry([{ table: "requests", id: "a", remove: true }]))).toBe(rows);
  });
});
