// The archive job reloads a monthly file and must recognize the events it
// already holds. This runs the shared sheet code through a real ExcelJS
// save-and-load round trip.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  addEmptyEventRow, addRequestRows, archivedEventIds, REQUEST_SHEET, setupRequestSheet, type ExportRow,
} from "../../../supabase/functions/_shared/excel.ts";

const row: ExportRow = {
  event_id: "e1", event_name: "תרגיל", needed_by: "22:00:00", company_name: "פלוגה א", supplier_name: "מטבח",
  item_name: "ארגז מנות", quantity: 5, supplied_quantity: null, status: "ready", urgent: false,
  supplier_note: null, updated_at: "2026-10-27T08:00:00Z",
};

describe("archive sheet", () => {
  it("finds archived event ids after the file is saved and loaded again", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(REQUEST_SHEET);
    setupRequestSheet(ws);
    expect(archivedEventIds(ws).size).toBe(0);
    addRequestRows(ws, [row, { ...row, item_name: "מים" }]);
    addEmptyEventRow(ws, { id: "e2", name: "אירוע ריק", needed_by: null });

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(await wb.xlsx.writeBuffer());
    const sheet = reloaded.getWorksheet(REQUEST_SHEET)!;
    setupRequestSheet(sheet);

    expect(archivedEventIds(sheet)).toEqual(new Set(["e1", "e2"]));
    expect(sheet.getColumn("event_id").hidden).toBe(true);
    expect(sheet.getRow(1).getCell(1).value).toBe("אירוע");
  });
});
