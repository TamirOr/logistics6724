import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest } from "../test/fixtures";

const enqueue = vi.fn((..._args: unknown[]) => "entry-id");
const cancel = vi.fn();
vi.mock("./queue", () => ({ enqueue: (...a: unknown[]) => enqueue(...a), cancel: (id: string) => cancel(id) }));

const { collectSection, deleteRequest, setQuantity, setStatus, UNDO_DELAY_MS } = await import("./requests");
const lastEffects = () => enqueue.mock.calls.at(-1)![1] as { patch?: Record<string, unknown>; remove?: true }[];

beforeEach(() => {
  enqueue.mockClear();
  cancel.mockClear();
});

describe("setQuantity", () => {
  it("returns a handled request to pending and flags it, as the server does", () => {
    setQuantity(makeRequest({ status: "partial", supplied_quantity: 4 }), 12);
    expect(lastEffects()[0].patch).toEqual({
      quantity: 12, status: "pending", supplied_quantity: null, changed_after_handling: true,
    });
  });

  it("only changes the quantity of a pending request", () => {
    setQuantity(makeRequest({ status: "pending" }), 12);
    expect(lastEffects()[0].patch).toEqual({ quantity: 12 });
  });

  it("ignores no-op and invalid quantities", () => {
    setQuantity(makeRequest({ quantity: 5 }), 5);
    setQuantity(makeRequest(), 0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("deleteRequest", () => {
  it("removes a pending request after the undo delay", () => {
    deleteRequest(makeRequest({ status: "pending" }));
    expect(lastEffects()[0]).toMatchObject({ remove: true });
    expect(enqueue.mock.calls.at(-1)![2]).toBe(UNDO_DELAY_MS);
  });

  it("cancels a ready request so the supplier takes it back", () => {
    deleteRequest(makeRequest({ status: "ready" }));
    expect(lastEffects()[0].patch).toEqual({ status: "cancelled", previous_status: "ready" });
  });

  it("returns an undo that cancels the queued write", () => {
    deleteRequest(makeRequest())();
    expect(cancel).toHaveBeenCalledWith("entry-id");
  });
});

describe("collectSection", () => {
  it("collects only ready and partial requests", () => {
    const rows = [makeRequest({ status: "ready" }), makeRequest({ status: "partial" }), makeRequest({ status: "missing" })];
    collectSection("list", "supplier", rows);
    expect(lastEffects().map((e) => e.patch)).toEqual([
      { status: "collected", previous_status: "ready" },
      { status: "collected", previous_status: "partial" },
    ]);
  });
});

describe("setStatus", () => {
  it("keeps the supplied quantity only for partial and clears the changed flag", () => {
    setStatus(makeRequest(), "ready", 3);
    expect(lastEffects()[0].patch).toEqual({ status: "ready", supplied_quantity: null, changed_after_handling: false });
    setStatus(makeRequest(), "partial", 3);
    expect(lastEffects()[0].patch).toMatchObject({ status: "partial", supplied_quantity: 3 });
  });
});
