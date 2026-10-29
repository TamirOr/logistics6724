// Comments on a company's list. Writes go through the queue like request
// edits, so they show at once and work offline; the server fills in the
// writer, the side and the time, and enforces who may write where.
import { cancel, enqueue } from "./queue";
import { UNDO_DELAY_MS } from "./requests";
import type { CommentSide, ListComment } from "./types";

export const COMMENT_MAX_LENGTH = 500;

export function addComment(p: {
  listId: string; eventId: string; companyId: string; supplierId: string | null; side: CommentSide; body: string;
}) {
  const body = p.body.trim();
  if (!body) return;
  const id = crypto.randomUUID();
  const row: ListComment = {
    id, list_id: p.listId, event_id: p.eventId, company_id: p.companyId, supplier_id: p.supplierId, side: p.side,
    body, created_by: null, created_at: new Date().toISOString(),
  };
  enqueue(
    { kind: "insert", table: "list_comments", row: { id, list_id: p.listId, supplier_id: p.supplierId, body } },
    [{ table: "list_comments", id, insert: { ...row } }],
  );
}

/** Deletes after the undo delay, like a request. Returns the undo. */
export function deleteComment(c: ListComment): () => void {
  const entry = enqueue(
    { kind: "delete", table: "list_comments", id: c.id }, [{ table: "list_comments", id: c.id, remove: true }], UNDO_DELAY_MS,
  );
  return () => cancel(entry);
}

const oldestFirst = (a: ListComment, b: ListComment) => a.created_at.localeCompare(b.created_at);

/** The comments between the company and one supplier, or (null) the company's general ones, oldest first. */
export const commentsWith = (comments: ListComment[], supplierId: string | null) =>
  comments.filter((c) => c.supplier_id === supplierId).sort(oldestFirst);

/** What a supplier reads on a list: the company's general comments and those between them, oldest first. */
export const commentsForSupplier = (comments: ListComment[], supplierId: string) =>
  comments.filter((c) => c.supplier_id === null || c.supplier_id === supplierId).sort(oldestFirst);
