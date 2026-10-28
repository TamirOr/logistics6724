import { useCallback, useEffect, useState } from "react";
import { fetchEvent } from "../lib/api";
import { eventCache, useRealtime } from "../lib/live";
import type { LogisticsEvent } from "../lib/types";

/**
 * One event, live. undefined while loading, null if not visible. Starts
 * from the saved copy, which also stays on screen with no signal.
 */
export function useEvent(id: string | undefined) {
  const [event, setEvent] = useState<LogisticsEvent | null | undefined>(() => (id ? eventCache.get(id) : undefined));
  const refetch = useCallback(async () => {
    if (!id) return;
    try {
      const e = await fetchEvent(id);
      if (e) eventCache.put([e]);
      setEvent(e);
    } catch {
      // Offline: keep the saved copy.
    }
  }, [id]);

  useEffect(() => {
    setEvent(id ? eventCache.get(id) : undefined);
    refetch();
  }, [id, refetch]);

  // Deletes arrive for every event (Realtime cannot filter them), so the
  // id is checked; an archived or deleted event leaves the screen.
  useRealtime<LogisticsEvent>("events", id ? `id=eq.${id}` : null, (c) => {
    if (c.eventType === "UPDATE") {
      eventCache.put([c.new as LogisticsEvent]);
      setEvent(c.new as LogisticsEvent);
    } else if (id && c.eventType === "DELETE" && (c.old as { id?: string }).id === id) {
      eventCache.drop(id);
      setEvent(null);
    }
  }, refetch);

  return { event, refetch };
}
