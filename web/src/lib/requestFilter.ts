// Narrows a list of requests to one item category and one status, so a long
// list reads by what the user is looking for ("מה חסר במוצרי חלב?").

import type { RequestStatus } from "./types";

/** The category option for items with no category, the general group. Typed categories are trimmed, so none equals it. */
export const GENERAL_CATEGORY = "\n";

export interface RequestFilter {
  /** "" for every category, GENERAL_CATEGORY for the general group, else a category name. */
  category: string;
  /** "" for every status. */
  status: RequestStatus | "";
}

export const NO_FILTER: RequestFilter = { category: "", status: "" };

export const isFiltering = (f: RequestFilter) => f.category !== "" || f.status !== "";

export function filterRequests<T extends { status: RequestStatus }>(
  rows: T[], f: RequestFilter, categoryOf: (row: T) => string | null | undefined,
): T[] {
  return rows.filter((r) =>
    (f.status === "" || r.status === f.status)
    && (f.category === "" || (categoryOf(r) ?? GENERAL_CATEGORY) === f.category));
}

/** The categories the rows use, alphabetically, the general group last. None when no row has a category. */
export function categoryOptions<T>(rows: T[], categoryOf: (row: T) => string | null | undefined): string[] {
  const used = new Set(rows.map((r) => categoryOf(r) ?? GENERAL_CATEGORY));
  const named = [...used].filter((c) => c !== GENERAL_CATEGORY).sort((a, b) => a.localeCompare(b, "he"));
  if (named.length === 0) return [];
  return used.has(GENERAL_CATEGORY) ? [...named, GENERAL_CATEGORY] : named;
}
