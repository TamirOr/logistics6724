// "ייצוא לאקסל": builds the file in the browser from export_rows.
import { supabase } from "./supabase";
import { t } from "../strings";
import {
  addRequestRows, fillTotalsSheet, REQUEST_SHEET, setupRequestSheet, TOTALS_SHEET, type ExportRow, type TotalRow,
} from "../../../supabase/functions/_shared/excel.ts";

async function download(build: (wb: import("exceljs").Workbook) => void, fileName: string) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  build(wb);
  const blob = new Blob([await wb.xlsx.writeBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

interface RowFilter { eventId?: string; sinceIso?: string; untilIso?: string; openOnly?: boolean }

async function fetchRows(filter: RowFilter): Promise<ExportRow[]> {
  let q = supabase.from("export_rows").select("*")
    .order("event_created_at").order("company_name").order("supplier_name").order("item_name");
  if (filter.eventId) q = q.eq("event_id", filter.eventId);
  if (filter.sinceIso) q = q.gte("event_created_at", filter.sinceIso);
  if (filter.untilIso) q = q.lt("event_created_at", filter.untilIso);
  if (filter.openOnly) q = q.eq("event_status", "open").neq("status", "collected");
  const { data, error } = await q;
  if (error) throw error;
  return data as ExportRow[];
}

function sheetFromRows(rows: ExportRow[]) {
  return (wb: import("exceljs").Workbook) => {
    const ws = wb.addWorksheet(REQUEST_SHEET);
    setupRequestSheet(ws);
    addRequestRows(ws, rows);
  };
}

export async function exportEvent(eventId: string, eventName: string) {
  await download(sheetFromRows(await fetchRows({ eventId })), `${eventName}.xlsx`);
}

/** The supplier's by-company view: open requests, optionally of one event. */
export async function exportOpenRequests(eventId?: string) {
  await download(sheetFromRows(await fetchRows({ eventId, openOnly: true })), `${t.openEvents}.xlsx`);
}

export async function exportHistory(sinceIso: string, untilIso: string, label: string) {
  await download(sheetFromRows(await fetchRows({ sinceIso, untilIso })), `${t.history} ${label}.xlsx`);
}

export async function exportTotals(rows: TotalRow[]) {
  await download((wb) => fillTotalsSheet(wb.addWorksheet(TOTALS_SHEET), rows), `${t.aggregate}.xlsx`);
}
