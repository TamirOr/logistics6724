import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListComment } from "./types";

const enqueue = vi.fn((..._args: unknown[]) => "entry-id");
const cancel = vi.fn();
vi.mock("./queue", () => ({ enqueue: (...a: unknown[]) => enqueue(...a), cancel: (id: string) => cancel(id) }));

const { addComment, commentsForSupplier, commentsWith, deleteComment } = await import("./comments");
const { UNDO_DELAY_MS } = await import("./requests");

const comment = (overrides: Partial<ListComment>): ListComment => ({
  id: crypto.randomUUID(), list_id: "list", event_id: "event", company_id: "company", supplier_id: null,
  side: "customer", body: "הערה", created_by: null, created_at: "2026-10-29T08:00:00Z", ...overrides,
});

beforeEach(() => {
  enqueue.mockClear();
  cancel.mockClear();
});

describe("addComment", () => {
  const comment = { listId: "l", eventId: "e", companyId: "c", supplierId: "s", side: "customer" as const };

  it("sends only what the client chooses, trimmed, and shows the whole row at once", () => {
    addComment({ ...comment, body: "  נגיע ב-14:00 " });
    const [mutation, effects] = enqueue.mock.calls.at(-1)! as [{ row: Record<string, unknown> }, { insert: ListComment }[]];
    expect(Object.keys(mutation.row).sort()).toEqual(["body", "id", "list_id", "supplier_id"]);
    expect(mutation.row).toMatchObject({ list_id: "l", supplier_id: "s", body: "נגיע ב-14:00" });
    expect(effects[0].insert).toMatchObject({ side: "customer", company_id: "c", event_id: "e", body: "נגיע ב-14:00" });
  });

  it("skips a blank comment", () => {
    addComment({ ...comment, body: "   " });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("deleteComment", () => {
  it("hides the comment at once and deletes it after the undo delay", () => {
    deleteComment(comment({ id: "x" }));
    expect(enqueue.mock.calls.at(-1)![1]).toEqual([{ table: "list_comments", id: "x", remove: true }]);
    expect(enqueue.mock.calls.at(-1)![2]).toBe(UNDO_DELAY_MS);
  });

  it("returns an undo that cancels the queued delete", () => {
    deleteComment(comment({}))();
    expect(cancel).toHaveBeenCalledWith("entry-id");
  });
});

describe("which comments a thread shows", () => {
  const comments = [
    comment({ body: "לכולם, מאוחר", created_at: "2026-10-29T09:00:00Z" }),
    comment({ body: "לאפסנאות", supplier_id: "store" }),
    comment({ body: "מהאפסנאות", supplier_id: "store", side: "supplier", created_at: "2026-10-29T08:30:00Z" }),
    comment({ body: "למטבח", supplier_id: "kitchen" }),
    comment({ body: "לכולם, מוקדם", created_at: "2026-10-29T07:00:00Z" }),
  ];
  const bodies = (list: ListComment[]) => list.map((c) => c.body);

  it("between the company and one supplier, both sides, oldest first", () => {
    expect(bodies(commentsWith(comments, "store"))).toEqual(["לאפסנאות", "מהאפסנאות"]);
  });

  it("the company's general comments", () => {
    expect(bodies(commentsWith(comments, null))).toEqual(["לכולם, מוקדם", "לכולם, מאוחר"]);
  });

  it("a supplier's: general and its own, not another supplier's", () => {
    expect(bodies(commentsForSupplier(comments, "store"))).toEqual(["לכולם, מוקדם", "לאפסנאות", "מהאפסנאות", "לכולם, מאוחר"]);
  });
});
