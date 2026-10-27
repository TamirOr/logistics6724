// Event dates as people read them, shared by the app and the Excel files.

/** The battalion's time zone. The database has the same value in app_config.timezone. */
export const TIMEZONE = "Asia/Jerusalem";

/** "יום שלישי, 3.11" for a date-only value (YYYY-MM-DD). */
export function formatEventDate(isoDate: string): string {
  // A date has no time zone; format it as UTC so the day never shifts.
  return new Intl.DateTimeFormat("he-IL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "numeric" })
    .format(new Date(`${isoDate}T00:00:00Z`));
}

/** When an event is needed: "יום שלישי, 3.11 · 06:30", the date or the time alone, or "". */
export function formatNeededFor(neededOn: string | null, neededBy: string | null): string {
  const time = neededBy ? neededBy.slice(0, 5) : "";
  if (!neededOn) return time;
  return time ? `${formatEventDate(neededOn)} · ${time}` : formatEventDate(neededOn);
}
