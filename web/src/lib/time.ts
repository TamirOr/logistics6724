import { formatNeededFor, TIMEZONE } from "../../../supabase/functions/_shared/dates.ts";
import type { LogisticsEvent } from "./types";

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d);

/** Today in Israel, as YYYY-MM-DD for date inputs. */
export const todayIso = () => dayKey(new Date());

/** When an event is needed: "יום שלישי, 3.11 · 06:30", or the date alone. */
export const formatNeededBy = (e: Pick<LogisticsEvent, "needed_on" | "needed_by">): string =>
  formatNeededFor(e.needed_on, e.needed_by);

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "numeric", year: "2-digit" })
    .format(new Date(iso));
}

/** When something was written: "14:05" today, "3.11 14:05" on another day. */
export function formatWrittenAt(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  if (dayKey(at) === dayKey(now)) return time;
  const day = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, day: "numeric", month: "numeric" }).format(at);
  return `${day} ${time}`;
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
