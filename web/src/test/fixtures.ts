import type { Profile, Request } from "../lib/types";

export function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: crypto.randomUUID(), list_id: "list", event_id: "event", company_id: "company", supplier_id: "supplier",
    item_id: "item", quantity: 10, measure: null, urgent: false, status: "pending", previous_status: null,
    supplied_quantity: null, supplier_note: null, customer_note: null, changed_after_handling: false,
    created_at: "2026-10-27T08:00:00Z", updated_at: "2026-10-27T08:00:00Z",
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: crypto.randomUUID(), email: "user@example.com", first_name: "ישראל", last_name: "ישראלי",
    service_number: "1234567", role: "customer", unit_id: "company", supplier_ids: [], pending_supplier_ids: [], approval: "approved",
    rejection_reason: null, active: true, super_user: false, acting_unit_id: null, acting_kind: null, created_at: "2026-10-27T08:00:00Z",
    ...overrides,
  };
}
