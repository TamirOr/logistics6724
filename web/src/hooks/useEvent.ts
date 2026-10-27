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

  useRealtime<LogisticsEvent>("events", id ? `id=eq.${id}` : null, (c) => {
    if (c.eventType === "UPDATE") {
      eventCache.put([c.new as LogisticsEvent]);
      setEvent(c.new as LogisticsEvent);
    }
  }, refetch);

  return { event, refetch };
}
