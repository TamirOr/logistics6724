// Open events the viewer can see, with list overviews, kept fresh by
// realtime changes to events and to the given requests filter. The last
// result is cached per user, so the home screen shows it at once.
import { useCallback, useEffect, useState } from "react";
import { fetchEvents, fetchOpenListOverviews } from "../lib/api";
import { readCache, writeCache } from "../lib/cache";
import { useRealtime } from "../lib/live";
import { useProfile } from "../lib/session";
import type { ListOverview, LogisticsEvent } from "../lib/types";

const REFRESH_DEBOUNCE_MS = 400;

interface OpenEvents { events: LogisticsEvent[]; lists: ListOverview[] }

export function useOpenEvents(requestsFilter: string | null) {
  const cacheKey = `open-events:${useProfile().id}`;
  const [data, setData] = useState<OpenEvents | null>(() => readCache<OpenEvents>(cacheKey));

  const refresh = useCallback(async () => {
    const [events, lists] = await Promise.all([fetchEvents("open"), fetchOpenListOverviews()]);
    setData({ events, lists });
    writeCache(cacheKey, { events, lists });
  }, [cacheKey]);

  // Bursts of changes (a supplier marking a whole list) refresh once.
  const [tick, setTick] = useState(0);
  const poke = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const timer = setTimeout(refresh, tick ? REFRESH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [tick, refresh]);

  useRealtime("events", "", poke, poke);
  useRealtime("requests", requestsFilter, poke);
  useRealtime("lists", "", poke);

  return { events: data?.events ?? null, lists: data?.lists ?? [], refresh };
}
