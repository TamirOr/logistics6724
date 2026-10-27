import type { Request } from "../lib/types";

export function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: crypto.randomUUID(), list_id: "list", event_id: "event", company_id: "company", supplier_id: "supplier",
    item_id: "item", quantity: 10, urgent: false, status: "pending", previous_status: null,
    supplied_quantity: null, supplier_note: null, changed_after_handling: false,
    created_at: "2026-10-27T08:00:00Z", updated_at: "2026-10-27T08:00:00Z",
    ...overrides,
  };
}
