import { formatNeededFor } from "../../../supabase/functions/_shared/dates.ts";
import type { LogisticsEvent } from "./types";

const TZ = "Asia/Jerusalem";

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** Today in Israel, as YYYY-MM-DD for date inputs. */
export const todayIso = () => dayKey(new Date());

/** When an event is needed: "יום שלישי, 3.11 · 06:30", or the date alone. */
export const formatNeededBy = (e: Pick<LogisticsEvent, "needed_on" | "needed_by">): string =>
  formatNeededFor(e.needed_on, e.needed_by);

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", year: "2-digit" })
    .format(new Date(iso));
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
