// Row types for the tables and views the app reads. Names match the
// database (see supabase/migrations).
import type { RequestStatus } from "../../../supabase/functions/_shared/labels.ts";
export type { RequestStatus };

export type UnitKind = "company" | "supplier";
export type UserRole = "customer" | "supplier" | "admin";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type EventScope = "company" | "battalion";
export type EventStatus = "open" | "closed" | "cancelled";
export type ListStatus = "empty" | "open" | "in_progress" | "ready_for_pickup" | "collected";

export interface Unit {
  id: string;
  name: string;
  kind: UnitKind;
  sort_order: number;
  active: boolean;
}

export interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  service_number: string;
  role: UserRole;
  unit_id: string | null;
  approval: ApprovalStatus;
  rejection_reason: string | null;
  active: boolean;
  created_at: string;
}

export interface LogisticsEvent {
  id: string;
  name: string;
  scope: EventScope;
  needed_on: string | null;
  needed_by: string | null;
  needed_at: string | null;
  status: EventStatus;
  created_by: string | null;
  created_by_unit: string | null;
  created_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
}

export interface List {
  id: string;
  event_id: string;
  company_id: string;
}

export interface ListOverview extends List {
  company_name: string;
  n_total: number;
  n_pending: number;
  n_ready: number;
  n_partial: number;
  n_missing: number;
  n_collected: number;
  n_cancelled: number;
  n_urgent: number;
  status: ListStatus;
  last_update: string | null;
}

export interface Item {
  id: string;
  supplier_id: string;
  name: string;
  verified: boolean;
  active: boolean;
}

export interface Request {
  id: string;
  list_id: string;
  event_id: string;
  company_id: string;
  supplier_id: string;
  item_id: string;
  quantity: number;
  urgent: boolean;
  status: RequestStatus;
  previous_status: RequestStatus | null;
  supplied_quantity: number | null;
  supplier_note: string | null;
  changed_after_handling: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemSearchResult {
  id: string;
  name: string;
  verified: boolean;
  matched_alias: string | null;
  score: number;
  default_quantity: number | null;
}

export interface MergeSuggestion {
  item_id: string;
  suggested_id: string;
  suggested_name: string;
  score: number;
}
