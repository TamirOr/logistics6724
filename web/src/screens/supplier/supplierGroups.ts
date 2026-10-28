import type { Request } from "../../lib/types";

export interface CompanyGroup { companyId: string; rows: Request[] }

const byUrgencyThenAge = (a: Request, b: Request) =>
  Number(b.urgent) - Number(a.urgent) || a.created_at.localeCompare(b.created_at);

/**
 * The by-company view's layout, built once per change instead of filtering
 * and sorting per event and company on every render: for each event, its
 * companies alphabetically, each with its requests urgent first, then
 * oldest first.
 */
export function groupByEventAndCompany(rows: Request[], companyName: (id: string) => string): Map<string, CompanyGroup[]> {
  const byEvent = new Map<string, Map<string, Request[]>>();
  for (const r of rows) {
    const companies = byEvent.get(r.event_id) ?? new Map<string, Request[]>();
    byEvent.set(r.event_id, companies.set(r.company_id, [...(companies.get(r.company_id) ?? []), r]));
  }
  const result = new Map<string, CompanyGroup[]>();
  byEvent.forEach((companies, eventId) => {
    const groups = [...companies].map(([companyId, list]) => ({ companyId, rows: list.sort(byUrgencyThenAge) }))
      .sort((a, b) => companyName(a.companyId).localeCompare(companyName(b.companyId), "he"));
    result.set(eventId, groups);
  });
  return result;
}
