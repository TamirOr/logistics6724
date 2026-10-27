// Calls that need an answer from the server before the screen moves on:
// sign-up, opening events, catalog lookups and admin actions. Request
// edits go through lib/requests.ts instead, so they work offline.
import { supabase } from "./supabase";
import type {
  EventScope, ItemSearchResult, ListOverview, LogisticsEvent, MergeSuggestion, Profile, Unit, UserRole,
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

/** The signed-in user's profile; null before sign-up. Throws when offline. */
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export const registerProfile = (p: {
  firstName: string; lastName: string; serviceNumber: string; role: UserRole; unitId: string;
}) => rpc<Profile>("register_profile", {
  p_first_name: p.firstName, p_last_name: p.lastName, p_service_number: p.serviceNumber,
  p_role: p.role, p_unit_id: p.unitId,
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

export async function fetchEvent(id: string): Promise<LogisticsEvent | null> {
  const { data } = await supabase.from("events").select("*").eq("id", id).maybeSingle();
  return data as LogisticsEvent | null;
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
  rpc<ItemSearchResult[]>("search_items", { p_supplier: supplierId, p_q: q });

export const suggestItems = (supplierId: string, name: string) =>
  rpc<{ id: string; name: string; score: number }[]>("suggest_items", { p_supplier: supplierId, p_name: name });

export const addItem = (supplierId: string, name: string) =>
  rpc<string>("add_item", { p_supplier: supplierId, p_name: name });

export const mergeItem = (sourceId: string, targetId: string) =>
  rpc<void>("merge_item", { p_source: sourceId, p_target: targetId });

export const mergeSuggestions = (supplierId: string) =>
  rpc<MergeSuggestion[]>("merge_suggestions", { p_supplier: supplierId });

export async function updateItem(id: string, patch: { name?: string; active?: boolean; verified?: boolean }) {
  const { error } = await supabase.from("items").update(patch).eq("id", id);
  if (error) throw error;
}

// Admin --------------------------------------------------------------------------

export const fetchUsers = () =>
  rows<Profile>(supabase.from("users").select("*").order("created_at", { ascending: false }));

export const approveUser = (id: string) => rpc<void>("approve_user", { p_user: id });
export const rejectUser = (id: string, reason: string) => rpc<void>("reject_user", { p_user: id, p_reason: reason });
export const setUserActive = (id: string, active: boolean) => rpc<void>("set_user_active", { p_user: id, p_active: active });
export const moveUser = (id: string, unitId: string) => rpc<void>("move_user", { p_user: id, p_unit: unitId });

export async function saveUnit(unit: Omit<Unit, "id"> & { id?: string }) {
  const { error } = unit.id
    ? await supabase.from("units").update(unit).eq("id", unit.id)
    : await supabase.from("units").insert(unit);
  if (error) throw error;
}

// Push -----------------------------------------------------------------------------

/** The deploy workflow stores the VAPID public key in app_config. */
export const fetchVapidPublicKey = () => rpc<string | null>("config", { k: "vapid_public_key" });

export async function savePushSubscription(userId: string, sub: PushSubscriptionJSON) {
  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys?.p256dh, auth: sub.keys?.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: "endpoint" });
  if (error) throw error;
}
