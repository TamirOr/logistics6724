// Fills an ExcelJS worksheet with the export columns from the spec. Used in
// the browser (export) and in the archive Edge Function, which pass their
// own ExcelJS build.
import { STATUS_LABELS, type RequestStatus } from "./labels.ts";

export interface ExportRow {
  event_name: string;
  needed_by: string | null;
  company_name: string;
  supplier_name: string;
  item_name: string;
  quantity: number;
  supplied_quantity: number | null;
  status: RequestStatus;
  urgent: boolean;
  supplier_note: string | null;
  updated_at: string;
}

// deno-lint-ignore no-explicit-any
type Worksheet = any;

export const REQUEST_SHEET = "דרישות";
export const TOTALS_SHEET = "סיכום";

export const REQUEST_COLUMNS = [
  { header: "אירוע", key: "event", width: 24 },
  { header: "נדרש עד", key: "needed_by", width: 10 },
  { header: "פלוגה", key: "company", width: 16 },
  { header: "גורם אספקה", key: "supplier", width: 16 },
  { header: "פריט", key: "item", width: 28 },
  { header: "כמות", key: "quantity", width: 8 },
  { header: "כמות שסופקה", key: "supplied", width: 12 },
  { header: "סטטוס", key: "status", width: 16 },
  { header: "דחוף", key: "urgent", width: 8 },
  { header: "הערת ספק", key: "note", width: 30 },
  { header: "עודכן לאחרונה", key: "updated", width: 18 },
];

export function formatDateTime(iso: string, timeZone = "Asia/Jerusalem"): string {
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
      needed_by: r.needed_by ? r.needed_by.slice(0, 5) : "",
      company: r.company_name,
      supplier: r.supplier_name,
      item: r.item_name,
      quantity: r.quantity,
      supplied: r.supplied_quantity ?? "",
      status: STATUS_LABELS[r.status],
      urgent: r.urgent ? "כן" : "",
      note: r.supplier_note ?? "",
      updated: formatDateTime(r.updated_at),
    });
  }
}

export interface TotalRow { item_name: string; supplier_name: string; quantity: number }

export function fillTotalsSheet(ws: Worksheet, rows: TotalRow[]): void {
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  ws.columns = [
    { header: "פריט", key: "item", width: 28 },
    { header: "גורם אספקה", key: "supplier", width: 16 },
    { header: "כמות כוללת", key: "quantity", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow({ item: r.item_name, supplier: r.supplier_name, quantity: r.quantity });
}
