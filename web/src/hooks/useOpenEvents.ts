// Open events the viewer can see, with list overviews, kept fresh by
// realtime changes to events, lists and requests of the given company
// filter ("" for all). The last result is cached per user, so the home
// screen shows it at once.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { fetchEvents, fetchOpenListOverviews } from "../lib/api";
import { readCache, writeCache } from "../lib/cache";
import { useRealtime } from "../lib/live";
import { useProfile } from "../lib/session";
import type { ListOverview, LogisticsEvent } from "../lib/types";

const REFRESH_DEBOUNCE_MS = 400;

export interface OpenEvents { events: LogisticsEvent[]; lists: ListOverview[] }

type EventChange = RealtimePostgresChangesPayload<LogisticsEvent & Record<string, unknown>>;

/**
 * Open events after one change to an event. The change carries the whole
 * row, so the list overviews need no reload: an event that closed or was
 * deleted leaves with its lists, and a new one gets its lists from their
 * own inserts. Newest first, as fetchEvents returns them.
 */
export function applyEventChange(data: OpenEvents, change: EventChange): OpenEvents {
  const id = change.eventType === "DELETE" ? (change.old as { id?: string }).id : change.new.id;
  const others = data.events.filter((e) => e.id !== id);
  if (change.eventType !== "DELETE" && change.new.status === "open") {
    const events = [...others, change.new as LogisticsEvent].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { ...data, events };
  }
  return { events: others, lists: data.lists.filter((l) => l.event_id !== id) };
}

export function useOpenEvents(companyFilter: string) {
  const cacheKey = `open-events:${useProfile().id}`;
  const [data, setData] = useState<OpenEvents | null>(() => readCache<OpenEvents>(cacheKey));
  const dataRef = useRef(data);
  dataRef.current = data;

  const refresh = useCallback(async () => {
    const [events, lists] = await Promise.all([fetchEvents("open"), fetchOpenListOverviews()]);
    setData({ events, lists });
    writeCache(cacheKey, { events, lists });
  }, [cacheKey]);

  // Bursts of changes (a supplier marking a whole list) refresh once.
  const [tick, setTick] = useState(0);
  const poke = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    // Offline the saved copy stays; reconnecting to events pokes again.
    const timer = setTimeout(() => refresh().catch(() => {}), tick ? REFRESH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [tick, refresh]);

  const onEventChange = useCallback((change: EventChange) => {
    // A closed event that reopened (an unmarked pickup) needs its lists.
    const reopened = change.eventType === "UPDATE" && change.new.status === "open"
      && !dataRef.current?.events.some((e) => e.id === change.new.id);
    if (reopened) poke();
    setData((current) => {
      if (!current) return current;
      const next = applyEventChange(current, change);
      writeCache(cacheKey, next);
      return next;
    });
  }, [cacheKey, poke]);

  useRealtime<LogisticsEvent>("events", "", onEventChange, poke);
  useRealtime("requests", companyFilter, poke);
  useRealtime("lists", companyFilter, poke);

  return { events: data?.events ?? null, lists: data?.lists ?? [], refresh };
}
