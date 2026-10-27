// Open events the viewer can see, with list overviews, kept fresh by
// realtime changes to events and to the given requests filter.
import { useCallback, useEffect, useState } from "react";
import { fetchEvents, fetchListOverviews } from "../lib/api";
import { useRealtime } from "../lib/live";
import type { ListOverview, LogisticsEvent } from "../lib/types";

const REFRESH_DEBOUNCE_MS = 400;

export function useOpenEvents(requestsFilter: string | null) {
  const [events, setEvents] = useState<LogisticsEvent[] | null>(null);
  const [lists, setLists] = useState<ListOverview[]>([]);

  const refresh = useCallback(async () => {
    const evs = await fetchEvents("open");
    setEvents(evs);
    setLists(await fetchListOverviews(evs.map((e) => e.id)));
  }, []);

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

  return { events, lists, refresh };
}
