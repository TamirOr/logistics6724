// Offline-first write queue.
//
// Every write the user makes goes through enqueue(). The entry is saved to
// localStorage, its optimistic effects show on screen at once (see
// applyEffects), and it is sent in the background in order. Network errors
// keep the entry and retry with backoff. Errors from the server (a rule or
// permission) drop the entry and notify listeners, so the screen falls back
// to the server state.
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
  mutation: Mutation;
  effects: Effect[];
  notBefore: number;
  tries: number;
}

type CommitListener = (entry: QueueEntry, data: unknown) => void;
type RejectListener = (entry: QueueEntry, message: string) => void;

const STORAGE_KEY = "write-queue-v1";
const MAX_BACKOFF_MS = 30_000;

let entries: QueueEntry[] = load();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const changeListeners = new Set<() => void>();
const commitListeners = new Set<CommitListener>();
const rejectListeners = new Set<RejectListener>();

function load(): QueueEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function setEntries(next: QueueEntry[]) {
  entries = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: the queue still works for this session.
  }
  changeListeners.forEach((l) => l());
}

/** Queues a write. With delayMs it waits that long, so cancel() can undo it. */
export function enqueue(mutation: Mutation, effects: Effect[] = [], delayMs = 0): string {
  const id = crypto.randomUUID();
  setEntries([...entries, { id, mutation, effects, notBefore: Date.now() + delayMs, tries: 0 }]);
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

// A Postgres error carries a SQLSTATE code. A failed fetch has none.
function isNetworkError(error: { code?: string; message?: string }): boolean {
  return !navigator.onLine || !error.code || /fetch|network/i.test(error.message ?? "");
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const entry = entries.find((e) => e.notBefore <= Date.now());
      if (!entry) break;

      const { data, error } = await send(entry.mutation);
      const alreadyApplied = error?.code === "23505" && entry.mutation.kind === "insert";

      if (!error || alreadyApplied) {
        setEntries(entries.filter((e) => e.id !== entry.id));
        commitListeners.forEach((l) => l(entry, data));
      } else if (isNetworkError(error)) {
        const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** entry.tries);
        setEntries(entries.map((e) => (e.id === entry.id ? { ...e, tries: e.tries + 1, notBefore: Date.now() + backoff } : e)));
        break;
      } else {
        setEntries(entries.filter((e) => e.id !== entry.id));
        rejectListeners.forEach((l) => l(entry, error.message));
      }
    }
  } finally {
    flushing = false;
  }
  const next = Math.min(...entries.map((e) => e.notBefore));
  if (Number.isFinite(next)) scheduleFlush(Math.max(0, next - Date.now()));
}

// Back online: retry failed entries now. Entries still inside their undo
// delay keep waiting.
window.addEventListener("online", () => {
  setEntries(entries.map((e) => (e.tries > 0 ? { ...e, notBefore: Date.now() } : e)));
  scheduleFlush();
});
scheduleFlush();
