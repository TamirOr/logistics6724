// Offline-first write queue.
//
// Every write the user makes goes through enqueue(). The entry is saved to
// localStorage, its optimistic effects show on screen at once (see
// applyEffects), and it is sent in the background in order. Network errors
// keep the entry and retry with backoff; so does an expired session, after
// a refresh, and a server error page, a few times. Errors from the server
// (a rule or permission, or a request it refuses outright) drop the entry
// and notify listeners, so the screen falls back to the server state.
//
// The queue belongs to the signed-in user: it is stored per user id and
// only sent while that user is signed in, so on a shared phone one user's
// writes are never sent as another's.
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";

export type Mutation =
  | { kind: "insert"; table: string; row: Record<string, unknown> }
  | { kind: "update"; table: string; id: string; patch: Record<string, unknown> }
  | { kind: "delete"; table: string; id: string }
  | { kind: "rpc"; fn: string; args: Record<string, unknown> };

// How an entry changes local rows until the server confirms it.
export type Effect =
  | { table: string; id: string; patch: Record<string, unknown> }
  | { table: string; id: string; remove: true }
  | { table: string; id: string; insert: Record<string, unknown> };

export interface QueueEntry {
  id: string;
  /** When the user made the change. Missing on entries saved by older builds. */
  createdAt?: number;
  mutation: Mutation;
  effects: Effect[];
  notBefore: number;
  tries: number;
}

type CommitListener = (entry: QueueEntry, data: unknown) => void;
/** code is the Postgres error code, when the server sent one. */
type RejectListener = (entry: QueueEntry, message: string, code: string | undefined) => void;

const STORAGE_PREFIX = "write-queue-v1:";
const MAX_BACKOFF_MS = 30_000;

let userId: string | null = null;
let entries: QueueEntry[] = [];
let flushing = false;
let paused = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const changeListeners = new Set<() => void>();
const commitListeners = new Set<CommitListener>();
const rejectListeners = new Set<RejectListener>();

function load(user: string): QueueEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PREFIX + user) ?? "[]");
  } catch {
    return [];
  }
}

function setEntries(next: QueueEntry[]) {
  entries = next;
  if (userId) {
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(entries));
    } catch {
      // Storage full or blocked: the queue still works for this session.
    }
  }
  changeListeners.forEach((l) => l());
}

/** Switches to the signed-in user's queue (null when signed out) and sends what it holds. */
export function setQueueUser(next: string | null) {
  if (next === userId) return;
  userId = next;
  setEntries(next ? load(next) : []);
  scheduleFlush();
}

/**
 * Holds every write on the phone while this build is older than the
 * server's min_client_version; the reloaded build sends them.
 */
export function setQueuePaused(next: boolean) {
  paused = next;
  if (!paused) scheduleFlush();
}

/** Drops the signed-in user's unsent writes. Used on an explicit sign-out. */
export function clearQueue() {
  setEntries([]);
}

/** Queues a write. With delayMs it waits that long, so cancel() can undo it. */
export function enqueue(mutation: Mutation, effects: Effect[] = [], delayMs = 0): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  setEntries([...entries, { id, createdAt: now, mutation, effects, notBefore: now + delayMs, tries: 0 }]);
  scheduleFlush(delayMs);
  return id;
}

/** Drops a queued write that has not been sent yet. Returns false if it already went out. */
export function cancel(id: string): boolean {
  if (!entries.some((e) => e.id === id)) return false;
  setEntries(entries.filter((e) => e.id !== id));
  return true;
}

export function onCommitted(listener: CommitListener): () => void {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}

export function onRejected(listener: RejectListener): () => void {
  rejectListeners.add(listener);
  return () => rejectListeners.delete(listener);
}

function subscribe(listener: () => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function useQueue(): QueueEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

/** Rows of one table as the user should see them: server rows plus queued effects. */
export function applyEffects<T extends { id: string }>(table: string, rows: T[], queue: QueueEntry[]): T[] {
  let result = rows;
  for (const entry of queue) {
    for (const effect of entry.effects) {
      if (effect.table !== table) continue;
      if ("insert" in effect) {
        if (!result.some((r) => r.id === effect.id)) result = [...result, effect.insert as unknown as T];
      } else if ("remove" in effect) {
        result = result.filter((r) => r.id !== effect.id);
      } else {
        result = result.map((r) => (r.id === effect.id ? { ...r, ...effect.patch } : r));
      }
    }
  }
  return result;
}

function scheduleFlush(delayMs = 0) {
  clearTimeout(timer);
  timer = setTimeout(flush, delayMs);
}

async function send(m: Mutation) {
  switch (m.kind) {
    case "insert":
      return supabase.from(m.table).insert(m.row).select().single();
    case "update":
      return supabase.from(m.table).update(m.patch).eq("id", m.id).select().maybeSingle();
    case "delete":
      return supabase.from(m.table).delete().eq("id", m.id);
    case "rpc":
      return supabase.rpc(m.fn, m.args);
  }
}

type SendError = { code?: string; message?: string };

// A failed fetch has neither a SQLSTATE code nor an HTTP status: the server
// was not reached, so the write is kept for as long as that lasts.
function isNetworkError(error: SendError, status: number): boolean {
  return !navigator.onLine || (!error.code && !status) || /fetch|network/i.test(error.message ?? "");
}

// A gateway or server failure without a SQLSTATE code (an HTML 502 page, a
// timeout) may pass, so it is retried, but only a few times: a write the
// server can never take would otherwise block every write after it.
const MAX_SERVER_TRIES = 8;
function isServerHiccup(error: SendError, status: number, entry: QueueEntry): boolean {
  return !error.code && status >= 500 && entry.tries < MAX_SERVER_TRIES;
}

// PostgREST answers PGRST301 when the access token expired, typical after
// hours offline. That is not a rejection of the write.
function isExpiredSession(error: SendError): boolean {
  return error.code === "PGRST301" || /jwt expired/i.test(error.message ?? "");
}

const without = (entry: QueueEntry) => entries.filter((e) => e.id !== entry.id);

/**
 * The next entry to send, keeping writes in the order they were made. An
 * entry backing off after a failure blocks everything after it, so a later
 * write never overtakes it. An entry only waiting out its undo delay is
 * skipped: it is a delete, and nothing queued after it depends on it.
 */
function nextToSend(now: number): QueueEntry | undefined {
  for (const e of entries) {
    if (e.notBefore <= now) return e;
    if (e.tries > 0) return undefined;
  }
  return undefined;
}

// An update that matched no row was refused by row-level security or hit a
// row that no longer exists. Either way it did not apply.
export const UPDATE_MISSED = "the row was not found or may not be changed";

function retryLater(entry: QueueEntry) {
  const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** entry.tries);
  setEntries(entries.map((e) => (e.id === entry.id ? { ...e, tries: e.tries + 1, notBefore: Date.now() + backoff } : e)));
}

/** Sends one entry. Returns false when the queue should stop for now. */
async function sendEntry(entry: QueueEntry, owner: string): Promise<boolean> {
  const result = await send(entry.mutation);
  const { data, status } = result;
  const missed = !result.error && entry.mutation.kind === "update" && data == null;
  const error = missed ? { code: "0ROWS", message: UPDATE_MISSED } : result.error;
  // Signed out or switched user while this was in flight: leave the queue
  // as it is now.
  if (userId !== owner) return false;

  if (!error || (error.code === "23505" && entry.mutation.kind === "insert")) {
    // A duplicate-key insert means an earlier try already landed.
    setEntries(without(entry));
    commitListeners.forEach((l) => l(entry, data));
    return true;
  }
  if (isExpiredSession(error)) {
    await supabase.auth.refreshSession();
    retryLater(entry);
    return false;
  }
  if (isNetworkError(error, status) || isServerHiccup(error, status, entry)) {
    retryLater(entry);
    return false;
  }
  setEntries(without(entry));
  rejectListeners.forEach((l) => l(entry, error.message ?? "", error.code || undefined));
  return true;
}

async function flush() {
  if (flushing || paused || !userId) return;
  flushing = true;
  const owner = userId;
  let entry: QueueEntry | undefined;
  try {
    while ((entry = nextToSend(Date.now())) && (await sendEntry(entry, owner)));
  } catch (e) {
    // Back off rather than retry at once, then let the error reach Sentry.
    if (entry) retryLater(entry);
    throw e;
  } finally {
    flushing = false;
    const next = Math.min(...entries.map((e) => e.notBefore));
    if (Number.isFinite(next)) scheduleFlush(Math.max(0, next - Date.now()));
  }
}

// Back online: retry failed entries now. Entries still inside their undo
// delay keep waiting.
window.addEventListener("online", () => {
  setEntries(entries.map((e) => (e.tries > 0 ? { ...e, notBefore: Date.now() } : e)));
  scheduleFlush();
});
