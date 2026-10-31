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
  /** סד״כ: soldiers in a company. Always null for a supplier. */
  headcount: number | null;
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
  /** The supplier units a supplier works in, unit_id among them once one approved them. Empty for customers and admins. */
  supplier_ids: string[];
  /** A supplier's supplier units still to approve them. Each unit approves on its own. */
  pending_supplier_ids: string[];
  approval: ApprovalStatus;
  rejection_reason: string | null;
  active: boolean;
  /** Approves sign-ups to their units and removes users from them. Set by admins. */
  super_user: boolean;
  /** Admins: the unit they work in as its customer or supplier (act_as_unit); null while they work as admin. */
  acting_unit_id: string | null;
  /** That unit's kind, while it is active. A deactivated unit returns the admin to admin. */
  acting_kind: UnitKind | null;
  created_at: string;
}

export interface LogisticsEvent {
  id: string;
  name: string;
  scope: EventScope;
  needed_on: string;
  needed_by: string | null;
  needed_at: string;
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
  /** Its group in the catalog ("מוצרי חלב"), or null for the general group. Set by the supplier. */
  category: string | null;
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
  /** What the quantity counts ("קרטון"), or null. Fixed once the request exists. */
  measure: string | null;
  urgent: boolean;
  status: RequestStatus;
  previous_status: RequestStatus | null;
  supplied_quantity: number | null;
  supplier_note: string | null;
  customer_note: string | null;
  changed_after_handling: boolean;
  created_at: string;
  updated_at: string;
}

/** The side a comment was written from. */
export type CommentSide = Extract<UserRole, "customer" | "supplier">;

/** A general remark on a company's list, from the company or from one supplier. */
export interface ListComment {
  id: string;
  list_id: string;
  event_id: string;
  company_id: string;
  /** The supplier it is between the company and; null for a company comment to every supplier. */
  supplier_id: string | null;
  side: CommentSide;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface ItemSearchResult {
  id: string;
  name: string;
  verified: boolean;
  matched_alias: string | null;
  /** Ranking: word similarity plus a boost for prefix matches. */
  score: number;
  /** Plain word similarity, which the "did you mean" threshold uses. */
  similarity: number;
  default_quantity: number | null;
  /** Measures companies used with this item, oldest first. */
  measures: string[];
  /** This company's last measure for the item. */
  default_measure: string | null;
}

export interface MergeSuggestion {
  item_id: string;
  suggested_id: string;
  suggested_name: string;
  score: number;
}

// Operations and support (admin screens) -------------------------------------

export interface HealthCheck { name: string; value: number | null; max: number; ok: boolean }

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
  metrics: Record<string, number | boolean | null>;
}

export interface AccessReviewRow {
  user_id: string;
  role: UserRole;
  unit_id: string | null;
  active: boolean;
  approved_at: string | null;
}
