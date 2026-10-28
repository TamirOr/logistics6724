// Every write to a request, with its optimistic effect. The rules mirror
// the requests_before_update trigger only so the screen updates at once;
// the database stays the authority.
import { cancel, enqueue } from "./queue";
import type { Request, RequestStatus } from "./types";

export const UNDO_DELAY_MS = 5000;
const HANDLED: RequestStatus[] = ["ready", "partial", "missing"];

export const isClosed = (r: Request) => r.status === "collected" || r.status === "cancelled";
/** Ready or partial: something waits at the pickup point. */
export const isCollectable = (r: Request) => r.status === "ready" || r.status === "partial";
/** Blank text is stored as null, as the server does. */
const cleanText = (text: string) => text.trim() || null;

function update(r: Request, patch: Partial<Request>) {
  enqueue({ kind: "update", table: "requests", id: r.id, patch }, [{ table: "requests", id: r.id, patch }]);
}

// Customer ------------------------------------------------------------------

export function addRequest(p: {
  listId: string; eventId: string; companyId: string; supplierId: string; itemId: string; quantity: number; measure: string;
}) {
  const id = crypto.randomUUID();
  const measure = cleanText(p.measure);
  const now = new Date().toISOString();
  const row: Request = {
    id, list_id: p.listId, event_id: p.eventId, company_id: p.companyId, supplier_id: p.supplierId,
    item_id: p.itemId, quantity: p.quantity, measure, urgent: false, status: "pending", previous_status: null,
    supplied_quantity: null, supplier_note: null, customer_note: null, changed_after_handling: false, created_at: now, updated_at: now,
  };
  enqueue(
    { kind: "insert", table: "requests", row: { id, list_id: p.listId, item_id: p.itemId, quantity: p.quantity, measure } },
    [{ table: "requests", id, insert: { ...row } }],
  );
}

export function setQuantity(r: Request, quantity: number) {
  if (quantity === r.quantity || quantity < 1) return;
  enqueue(
    { kind: "update", table: "requests", id: r.id, patch: { quantity } },
    [{
      table: "requests", id: r.id,
      patch: HANDLED.includes(r.status)
        ? { quantity, status: "pending", supplied_quantity: null, changed_after_handling: true }
        : { quantity },
    }],
  );
}

export function setUrgent(r: Request, urgent: boolean) {
  update(r, { urgent });
}

/** The company's own note. Leaves the status alone, as the server does. */
export function setCustomerNote(r: Request, note: string) {
  const customer_note = cleanText(note);
  if (customer_note !== r.customer_note) update(r, { customer_note });
}

/** Deletes after the undo delay. Ready or partial requests become cancelled. Returns the undo. */
export function deleteRequest(r: Request): () => void {
  const effect = isCollectable(r)
    ? { table: "requests", id: r.id, patch: { status: "cancelled", previous_status: r.status } }
    : { table: "requests", id: r.id, remove: true as const };
  const entry = enqueue({ kind: "rpc", fn: "delete_request", args: { p_request: r.id } }, [effect], UNDO_DELAY_MS);
  return () => cancel(entry);
}

export function collectSection(listId: string, supplierId: string, rows: Request[]) {
  const ready = rows.filter(isCollectable);
  enqueue(
    { kind: "rpc", fn: "mark_collected", args: { p_list: listId, p_supplier: supplierId } },
    ready.map((r) => ({ table: "requests", id: r.id, patch: { status: "collected", previous_status: r.status } })),
  );
}

/** Undoes a pickup or a cancel: back to the status before it. */
export function restoreRequest(r: Request) {
  if (!r.previous_status) return;
  enqueue(
    { kind: "rpc", fn: "restore_request", args: { p_request: r.id } },
    [{ table: "requests", id: r.id, patch: { status: r.previous_status, previous_status: null } }],
  );
}

// Supplier ------------------------------------------------------------------

export function setStatus(r: Request, status: RequestStatus, suppliedQuantity: number | null = null) {
  const patch = { status, supplied_quantity: status === "partial" ? suppliedQuantity : null };
  enqueue(
    { kind: "update", table: "requests", id: r.id, patch },
    [{ table: "requests", id: r.id, patch: { ...patch, changed_after_handling: false } }],
  );
}

export function setSupplierNote(r: Request, note: string) {
  update(r, { supplier_note: cleanText(note) });
}

/** The supplier took a cancelled request back into stock. */
export function acknowledgeCancel(r: Request) {
  enqueue({ kind: "delete", table: "requests", id: r.id }, [{ table: "requests", id: r.id, remove: true }]);
}
