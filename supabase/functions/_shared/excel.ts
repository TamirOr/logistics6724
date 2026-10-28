// Fills an ExcelJS worksheet with the export columns from the spec. Used in
// the browser (export) and in the archive Edge Function, which pass their
// own ExcelJS build.
import { formatNeededFor, TIMEZONE } from "./dates.ts";
import { STATUS_LABELS, type RequestStatus } from "./labels.ts";

export interface ExportRow {
  event_id: string;
  event_name: string;
  needed_on: string | null;
  needed_by: string | null;
  company_name: string;
  supplier_name: string;
  item_name: string;
  quantity: number;
  measure: string | null;
  supplied_quantity: number | null;
  status: RequestStatus;
  urgent: boolean;
  supplier_note: string | null;
  customer_note: string | null;
  updated_at: string;
}

// deno-lint-ignore no-explicit-any
type Worksheet = any;

export const REQUEST_SHEET = "דרישות";
export const TOTALS_SHEET = "סיכום";

export const REQUEST_COLUMNS = [
  { header: "אירוע", key: "event", width: 24 },
  { header: "נדרש עד", key: "needed_by", width: 22 },
  { header: "פלוגה", key: "company", width: 16 },
  { header: "גורם אספקה", key: "supplier", width: 16 },
  { header: "פריט", key: "item", width: 28 },
  { header: "כמות", key: "quantity", width: 8 },
  { header: "כמות שסופקה", key: "supplied", width: 12 },
  { header: "סטטוס", key: "status", width: 16 },
  { header: "דחוף", key: "urgent", width: 8 },
  { header: "הערת ספק", key: "note", width: 30 },
  { header: "עודכן לאחרונה", key: "updated", width: 18 },
  // Lets the archive job see which events a monthly file already holds.
  { header: "מזהה אירוע", key: "event_id", width: 38, hidden: true },
  // Added later, so they go last, newest at the end: the archive reopens
  // monthly files written with the columns above, and they must keep their
  // positions.
  { header: "הערת פלוגה", key: "customer_note", width: 30 },
  { header: "יחידת מידה", key: "measure", width: 14 },
];

export function formatDateTime(iso: string, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function setupRequestSheet(ws: Worksheet): void {
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  ws.columns = REQUEST_COLUMNS;
  ws.getRow(1).font = { bold: true };
}

export function addRequestRows(ws: Worksheet, rows: ExportRow[]): void {
  for (const r of rows) {
    ws.addRow({
      event: r.event_name,
      needed_by: formatNeededFor(r.needed_on, r.needed_by),
      company: r.company_name,
      supplier: r.supplier_name,
      item: r.item_name,
      quantity: r.quantity,
      supplied: r.supplied_quantity ?? "",
      status: STATUS_LABELS[r.status],
      urgent: r.urgent ? "כן" : "",
      note: r.supplier_note ?? "",
      updated: formatDateTime(r.updated_at),
      event_id: r.event_id,
      customer_note: r.customer_note ?? "",
      measure: r.measure ?? "",
    });
  }
}

/** One row for an event that had no requests, so it still leaves a trace. */
export function addEmptyEventRow(
  ws: Worksheet, e: { id: string; name: string; needed_on: string | null; needed_by: string | null },
): void {
  ws.addRow({ event: e.name, needed_by: formatNeededFor(e.needed_on, e.needed_by), event_id: e.id });
}

// The event id of every data row. Call after setupRequestSheet.
function eventIdCells(ws: Worksheet): string[] {
  const values: unknown[] = ws.getColumn("event_id").values;
  // values[0] is unused by ExcelJS and values[1] is the header.
  return values.slice(2).filter((v): v is string => typeof v === "string" && v !== "");
}

/** Event ids already written to a request sheet. Call after setupRequestSheet. */
export function archivedEventIds(ws: Worksheet): Set<string> {
  return new Set(eventIdCells(ws));
}

/** How many rows of the sheet belong to these events, to check an upload before deleting them. */
export function countEventRows(ws: Worksheet, eventIds: Set<string>): number {
  return eventIdCells(ws).filter((id) => eventIds.has(id)).length;
}

export interface TotalRow { item_name: string; supplier_name: string; quantity: number; measure: string | null }

export function fillTotalsSheet(ws: Worksheet, rows: TotalRow[]): void {
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  ws.columns = [
    { header: "פריט", key: "item", width: 28 },
    { header: "גורם אספקה", key: "supplier", width: 16 },
    { header: "כמות כוללת", key: "quantity", width: 12 },
    { header: "יחידת מידה", key: "measure", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow({ item: r.item_name, supplier: r.supplier_name, quantity: r.quantity, measure: r.measure ?? "" });
}
