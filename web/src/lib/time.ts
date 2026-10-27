import { t } from "../strings";
import type { LogisticsEvent } from "./types";

const TZ = "Asia/Jerusalem";

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** "22:00", or "מחר 06:00" when the event needs it the day after today. */
export function formatNeededBy(e: Pick<LogisticsEvent, "needed_by" | "needed_at">): string {
  if (!e.needed_by) return "";
  const time = e.needed_by.slice(0, 5);
  if (e.needed_at && dayKey(new Date(e.needed_at)) !== dayKey(new Date())) return `${t.neededByTomorrow} ${time}`;
  return time;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", year: "2-digit" })
    .format(new Date(iso));
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
