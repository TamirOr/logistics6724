import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest } from "../test/fixtures";

const enqueue = vi.fn((..._args: unknown[]) => "entry-id");
const cancel = vi.fn();
vi.mock("./queue", () => ({ enqueue: (...a: unknown[]) => enqueue(...a), cancel: (id: string) => cancel(id) }));

const {
  addRequest, collectSection, deleteRequest, markStatus, setCustomerNote, setQuantity, setStatus, UNDO_DELAY_MS,
} = await import("./requests");
const lastEffects = () => enqueue.mock.calls.at(-1)![1] as { patch?: Record<string, unknown>; remove?: true }[];

beforeEach(() => {
  enqueue.mockClear();
  cancel.mockClear();
});

describe("addRequest", () => {
  const request = { listId: "l", eventId: "e", companyId: "c", supplierId: "s", itemId: "i", quantity: 5 };
  const sent = () => (enqueue.mock.calls.at(-1)![0] as { row: Record<string, unknown> }).row;

  it("sends the trimmed measure", () => {
    addRequest({ ...request, measure: "  קרטון " });
    expect(sent()).toMatchObject({ item_id: "i", quantity: 5, measure: "קרטון" });
  });

  it("stores a blank measure as none", () => {
    addRequest({ ...request, measure: "  " });
    expect(sent().measure).toBeNull();
  });
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

describe("setCustomerNote", () => {
  it("trims the note and leaves the status alone, as the server does", () => {
    setCustomerNote(makeRequest({ status: "ready" }), "  מידה L ");
    expect(lastEffects()[0].patch).toEqual({ customer_note: "מידה L" });
  });

  it("stores a blank note as null", () => {
    setCustomerNote(makeRequest({ customer_note: "מידה L" }), "   ");
    expect(lastEffects()[0].patch).toEqual({ customer_note: null });
  });

  it("skips an unchanged note", () => {
    setCustomerNote(makeRequest({ customer_note: "מידה L" }), "מידה L ");
    setCustomerNote(makeRequest(), "");
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

describe("markStatus", () => {
  const sent = () => (enqueue.mock.calls.at(-1)![0] as { patch: Record<string, unknown> }).patch;

  it("sets an open status like the supplier, keeping the changed flag", () => {
    markStatus(makeRequest({ changed_after_handling: true }), "missing", 3);
    expect(lastEffects()[0].patch).toEqual({ status: "missing", supplied_quantity: null });
    markStatus(makeRequest(), "partial", 3);
    expect(lastEffects()[0].patch).toEqual({ status: "partial", supplied_quantity: 3 });
  });

  it("collects one request from any open status, remembering it for unmarking", () => {
    markStatus(makeRequest({ status: "pending" }), "collected");
    expect(sent()).toEqual({ status: "collected" });
    expect(lastEffects()[0].patch).toEqual({ status: "collected", previous_status: "pending" });
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
