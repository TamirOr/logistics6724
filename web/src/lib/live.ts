// Live rows: fetch once, follow Supabase Realtime, and show queued writes
// on top. Also small shared caches for rows many screens look up by id.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { applyEffects, onCommitted, useQueue } from "./queue";
import type { Item, LogisticsEvent, Unit } from "./types";

type Change<T> = RealtimePostgresChangesPayload<T & Record<string, unknown>>;

/**
 * Follows inserts, updates and deletes on a table. Realtime cannot filter
 * deletes, so they arrive unfiltered and carry only the row id. After a
 * reconnect, onResubscribed lets the caller catch up on missed changes; the
 * first connect skips it, since callers load their data on mount anyway.
 */
export function useRealtime<T>(table: string, filter: string | null, onChange: (c: Change<T>) => void,
  onResubscribed?: () => void) {
  const handlers = useRef({ onChange, onResubscribed });
  handlers.current = { onChange, onResubscribed };

  useEffect(() => {
    if (filter === null) return;
    const channel = supabase.channel(`${table}:${filter || "all"}:${crypto.randomUUID()}`);
    const forward = (c: Change<T>) => handlers.current.onChange(c);
    const rowFilter = filter || undefined;
    channel
      .on("postgres_changes", { event: "INSERT", schema: "public", table, filter: rowFilter }, forward)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: rowFilter }, forward)
      .on("postgres_changes", { event: "DELETE", schema: "public", table }, forward);
    let connectedBefore = false;
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (connectedBefore) handlers.current.onResubscribed?.();
      connectedBefore = true;
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter]);
}

interface LiveOptions<T> {
  /** Server-side filter column, also used for the realtime subscription. */
  column: string;
  value: string | null | undefined;
  /** Narrows the initial query, for example to skip collected requests. */
  narrow?: (q: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Rows to keep on screen. Realtime may bring rows the query skipped. */
  keep?: (row: T) => boolean;
}

export function useLiveRows<T extends { id: string }>(table: string, opts: LiveOptions<T>) {
  const { column, value } = opts;
  const [rows, setRows] = useState<Map<string, T>>(new Map());
  const [loading, setLoading] = useState(true);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const queue = useQueue();

  const refetch = useCallback(async () => {
    if (!value) return;
    let q = supabase.from(table).select("*").eq(column, value);
    if (optsRef.current.narrow) q = optsRef.current.narrow(q);
    const { data, error } = await q;
    if (!error) setRows(new Map((data as T[]).map((r) => [r.id, r])));
    setLoading(false);
  }, [table, column, value]);

  const upsert = (row: T) => setRows((m) => new Map(m).set(row.id, row));
  const remove = (id: string) =>
    setRows((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });

  useRealtime<T>(table, value ? `${column}=eq.${value}` : null, (change) => {
    if (change.eventType === "DELETE") {
      const id = (change.old as { id?: string }).id;
      if (id) remove(id);
    } else {
      upsert(change.new as T);
    }
  }, refetch);

  useEffect(() => {
    if (!value) return;
    setLoading(true);
    refetch();

    // A confirmed write returns the row; RPCs return no rows, so refetch.
    const stopCommits = onCommitted((entry, data) => {
      const m = entry.mutation;
      if (m.kind === "rpc") refetch();
      else if (m.table === table && m.kind !== "delete" && data) upsert(data as T);
      else if (m.table === table && m.kind === "delete") remove(m.id);
    });

    const onVisible = () => document.visibilityState === "visible" && refetch();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopCommits();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [table, column, value, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const merged = applyEffects(table, [...rows.values()], queue);
    const keep = optsRef.current.keep;
    return keep ? merged.filter(keep) : merged;
  }, [rows, queue, table]);

  return { rows: visible, loading, refetch };
}

// Id caches ------------------------------------------------------------------

function createCache<T extends { id: string }>(table: string) {
  const byId = new Map<string, T>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;

  const notify = () => {
    version++;
    listeners.forEach((l) => l());
  };

  return {
    get: (id: string) => byId.get(id),
    put(rows: T[]) {
      rows.forEach((r) => byId.set(r.id, r));
      notify();
    },
    async ensure(ids: Iterable<string>) {
      const missing = [...new Set(ids)].filter((id) => !byId.has(id) && !inFlight.has(id));
      if (!missing.length) return;
      missing.forEach((id) => inFlight.add(id));
      const { data } = await supabase.from(table).select("*").in("id", missing);
      missing.forEach((id) => inFlight.delete(id));
      if (data) this.put(data as T[]);
    },
    /** Re-renders the caller when the cache changes. */
    useVersion() {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => version,
      );
    },
  };
}

export const itemCache = createCache<Item>("items");
export const eventCache = createCache<LogisticsEvent>("events");

/** Looks up cached rows by id, fetching any not cached yet. */
export function useCached<T extends { id: string }>(cache: ReturnType<typeof createCache<T>>, ids: string[]) {
  cache.useVersion();
  const key = ids.join(",");
  useEffect(() => {
    cache.ensure(ids);
  }, [cache, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cache.get;
}

// Units change rarely and are few, so they load once per session.
let unitsPromise: Promise<Unit[]> | null = null;
export function loadUnits(force = false): Promise<Unit[]> {
  if (!unitsPromise || force) {
    unitsPromise = Promise.resolve(
      supabase.from("units").select("*").order("sort_order").order("name")
        .then(({ data }) => (data ?? []) as Unit[]),
    );
  }
  return unitsPromise;
}

export function useUnits(): Unit[] {
  const [units, setUnits] = useState<Unit[]>([]);
  useEffect(() => {
    loadUnits().then(setUnits);
  }, []);
  return units;
}
