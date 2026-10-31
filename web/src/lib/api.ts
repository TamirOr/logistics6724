// Calls that need an answer from the server before the screen moves on:
// sign-up, opening events, catalog lookups and admin actions. Request
// edits go through lib/requests.ts instead, so they work offline.
import { supabase } from "./supabase";
import type {
  AccessReviewRow, EventScope, HealthReport, Item, ItemSearchResult, List, ListOverview, LogisticsEvent, MergeSuggestion,
  Profile, Unit, UnitKind, UserRole,
} from "./types";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function rows<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as T[];
}

// Auth and profile -------------------------------------------------------------

export const sendCode = (email: string) =>
  supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
  });

export const verifyCode = (email: string, token: string) =>
  supabase.auth.verifyOtp({ email, token, type: "email" });

/** Admins: work as the customer or supplier of a unit, or (null) return to admin. */
export const workAsUnit = (unitId: string | null) =>
  unitId ? rpc<void>("act_as_unit", { p_unit: unitId }) : rpc<void>("return_to_admin");

// A users row with its supplier units and the unit an admin works in
// embedded, flattened into a Profile. users has two keys to units, so the
// embed names its key.
const PROFILE_COLUMNS = "*, user_suppliers(supplier_id, approved), acting_unit:units!users_acting_unit_id_fkey(kind)";
type ProfileRow = Omit<Profile, "supplier_ids" | "pending_supplier_ids" | "acting_kind">
  & { user_suppliers: { supplier_id: string; approved: boolean }[]; acting_unit: { kind: UnitKind } | null };
const toProfile = ({ user_suppliers, acting_unit, ...row }: ProfileRow): Profile => ({
  ...row,
  acting_kind: acting_unit?.kind ?? null,
  supplier_ids: user_suppliers.filter((s) => s.approved).map((s) => s.supplier_id),
  pending_supplier_ids: user_suppliers.filter((s) => !s.approved).map((s) => s.supplier_id),
});

/** The signed-in user's profile; null before sign-up. Throws when offline. */
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("users").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw error;
  return data && toProfile(data as ProfileRow);
}

/** The active units a new user may pick. */
export const fetchSignupUnits = () => rpc<Pick<Unit, "id" | "name" | "kind">[]>("signup_units");

/** unitIds: the customer's company, or the supplier's units, the first as its main unit. */
export const registerProfile = (p: {
  firstName: string; lastName: string; serviceNumber: string; role: UserRole; unitIds: string[];
}) => rpc<void>("register_profile", {
  p_first_name: p.firstName, p_last_name: p.lastName, p_service_number: p.serviceNumber,
  p_role: p.role, p_unit_id: p.unitIds[0], p_supplier_ids: p.role === "supplier" ? p.unitIds : null,
});

// Events -----------------------------------------------------------------------

/** When an event is needed: a date (YYYY-MM-DD) and a time of day (HH:MM), each optional. */
export interface NeededFor { neededOn: string; neededBy: string }

export const createEvent = (name: string, scope: EventScope, when: NeededFor) =>
  rpc<string>("create_event", {
    p_name: name, p_scope: scope, p_needed_on: when.neededOn || null, p_needed_by: when.neededBy || null,
  });

export const duplicateEvent = (sourceId: string, name: string, when: NeededFor) =>
  rpc<string>("duplicate_event", {
    p_source: sourceId, p_name: name, p_needed_on: when.neededOn || null, p_needed_by: when.neededBy || null,
  });

export const closeEvent = (id: string) => rpc<void>("close_event", { p_event: id });
export const cancelEvent = (id: string) => rpc<void>("cancel_event", { p_event: id });

/** One event, or null if it does not exist or is not visible. Throws when offline. */
export async function fetchEvent(id: string): Promise<LogisticsEvent | null> {
  const { data, error } = await supabase.from("events").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as LogisticsEvent | null;
}

/** A company's list in an event, or null. Throws when offline. */
export async function fetchCompanyList(eventId: string, companyId: string): Promise<List | null> {
  const { data, error } = await supabase.from("lists").select("*")
    .eq("event_id", eventId).eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return data as List | null;
}

export const fetchEvents = (status: "open" | "history", sinceIso?: string, untilIso?: string) => {
  let q = supabase.from("events").select("*").order("created_at", { ascending: false });
  q = status === "open" ? q.eq("status", "open") : q;
  if (sinceIso) q = q.gte("created_at", sinceIso);
  if (untilIso) q = q.lt("created_at", untilIso);
  return rows<LogisticsEvent>(q);
};

/** Counts for every list of every open event the viewer can see. */
export const fetchOpenListOverviews = () =>
  rows<ListOverview>(supabase.from("list_overview").select("*").eq("event_status", "open"));

export const fetchListOverviews = (eventIds: string[]) =>
  eventIds.length ? rows<ListOverview>(supabase.from("list_overview").select("*").in("event_id", eventIds)) : Promise.resolve([]);

// Catalog ------------------------------------------------------------------------

export const searchItems = (supplierId: string, q: string) =>
  rpc<ItemSearchResult[]>("search_catalog", { p_supplier: supplierId, p_q: q });

export type ItemMatch = Pick<ItemSearchResult, "id" | "name" | "default_quantity" | "measures" | "default_measure"> & { exact: boolean };

/** The exact catalog match for a typed name, or else up to 3 "did you mean" suggestions. */
export const matchItem = (supplierId: string, name: string) =>
  rpc<ItemMatch[]>("match_catalog", { p_supplier: supplierId, p_name: name });

/** A category given here applies to a new item only; a known item keeps its own. */
export const addItem = (supplierId: string, name: string, category = "") =>
  rpc<string>("add_catalog_item", { p_supplier: supplierId, p_name: name, p_category: category.trim() || null });

/** Customers: fills in the category of an item that has none. Returns it as stored. */
export const addItemCategory = (itemId: string, category: string) =>
  rpc<string>("add_item_category", { p_item: itemId, p_category: category });

export const supplierCategories = (supplierId: string) =>
  rpc<string[]>("supplier_categories", { p_supplier: supplierId });

export const mergeItem = (sourceId: string, targetId: string) =>
  rpc<void>("merge_item", { p_source: sourceId, p_target: targetId });

/** Refused while any request uses the item: hide or merge it instead. */
export const deleteItem = (id: string) => rpc<void>("delete_item", { p_item: id });

export const mergeSuggestions = (supplierId: string) =>
  rpc<MergeSuggestion[]>("merge_suggestions", { p_supplier: supplierId });

/** Returns the item as stored, with the category spelled as the server cleaned it. */
export async function updateItem(id: string, patch: { name?: string; active?: boolean; verified?: boolean; category?: string | null }) {
  const { data, error } = await supabase.from("items").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data as Item;
}

// Admin --------------------------------------------------------------------------

export const fetchUsers = async () =>
  (await rows<ProfileRow>(supabase.from("users").select(PROFILE_COLUMNS).order("created_at", { ascending: false })))
    .map(toProfile);

export const approveUser = (id: string) => rpc<void>("approve_user", { p_user: id });
export const rejectUser = (id: string, reason: string) => rpc<void>("reject_user", { p_user: id, p_reason: reason });
export const setUserActive = (id: string, active: boolean) => rpc<void>("set_user_active", { p_user: id, p_active: active });
export const setSuperUser = (id: string, superUser: boolean) =>
  rpc<void>("set_super_user", { p_user: id, p_super_user: superUser });
/** Super users: deactivates the user, or takes only the caller's units from a supplier in other units too. */
export const removeFromUnit = (id: string) => rpc<void>("remove_from_unit", { p_user: id });
/** Removes the profile for good. Their sign-in stays: signing in again starts a new sign-up. */
export const deleteUser = (id: string) => rpc<void>("delete_user", { p_user: id });
export const moveUser = (id: string, unitId: string) => rpc<void>("move_user", { p_user: id, p_unit: unitId });
/** A supplier's supplier units; the main unit stays while it is among them. */
export const setUserSuppliers = (id: string, supplierIds: string[]) =>
  rpc<void>("set_user_suppliers", { p_user: id, p_suppliers: supplierIds });

/** Pass or fail per health check, with the metrics behind them. Admins only. */
export const fetchAdminHealth = () => rpc<HealthReport>("admin_health");

export const fetchAccessReview = () => rpc<AccessReviewRow[]>("access_review");

export async function saveUnit(unit: Omit<Unit, "id"> & { id?: string }) {
  const { error } = unit.id
    ? await supabase.from("units").update(unit).eq("id", unit.id)
    : await supabase.from("units").insert(unit);
  if (error) throw error;
}

/** Refused while the unit has users or events use it: move the users or deactivate it instead. */
export const deleteUnit = (id: string) => rpc<void>("delete_unit", { p_unit: id });

// Push -----------------------------------------------------------------------------

/** A tuning value from app_config, with the default to use if it is unset. */
export const fetchTuning = (key: string, fallback: string) => rpc<string>("config", { k: key, fallback });

/** The deploy workflow stores the VAPID public key in app_config. */
export const fetchVapidPublicKey = () => rpc<string | null>("config", { k: "vapid_public_key" });

/** Registers this device's subscription to the signed-in user, taking it over from whoever had it. */
export const savePushSubscription = (sub: PushSubscriptionJSON) =>
  rpc<void>("register_push_subscription", {
    p_endpoint: sub.endpoint, p_p256dh: sub.keys?.p256dh, p_auth: sub.keys?.auth, p_user_agent: navigator.userAgent,
  });

/** The id of this device's subscription row, if the signed-in user has one. */
export async function fetchPushSubscriptionId(endpoint: string): Promise<string | null> {
  const { data, error } = await supabase.from("push_subscriptions").select("id").eq("endpoint", endpoint).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/** Queues a push to the caller only, at most once a minute. */
export const sendTestNotification = () => rpc<void>("send_test_notification");

export async function deletePushSubscription(endpoint: string) {
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}
