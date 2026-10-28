import { describe, expect, it } from "vitest";
import { addRequestRows, fillTotalsSheet, REQUEST_COLUMNS, setupRequestSheet } from "./excel.ts";

function fakeSheet() {
  return { rows: [] as Record<string, unknown>[], views: [] as unknown[], columns: [] as unknown[],
    getRow: () => ({ font: {} }), addRow(r: Record<string, unknown>) { this.rows.push(r); } };
}

describe("excel export rows", () => {
  it("sets right-to-left and every spec column", () => {
    const ws = fakeSheet();
    setupRequestSheet(ws);
    expect(ws.views[0]).toMatchObject({ rightToLeft: true });
    const visible = REQUEST_COLUMNS.filter((c) => !("hidden" in c && c.hidden));
    expect(visible).toHaveLength(14);
    expect(visible.map((c) => c.key)).toContain("supplied");
  });

  it("writes Hebrew status labels, the urgent mark and the short time", () => {
    const ws = fakeSheet();
    addRequestRows(ws, [{
      event_id: "e1", event_name: "תרגיל", needed_on: "2026-11-03", needed_by: "22:00:00", company_name: "פלוגה א", supplier_name: "מטבח",
      item_name: "ארגז מנות", item_category: null, quantity: 5, supplied_quantity: 3, status: "partial", urgent: true,
      supplier_note: null, customer_note: null, updated_at: "2026-10-27T08:00:00Z", measure: "קרטון",
    }]);
    expect(ws.rows[0]).toMatchObject({ needed_by: "יום שלישי, 3.11 · 22:00", status: "חלקי", urgent: "כן", supplied: 3, note: "", customer_note: "", measure: "קרטון", category: "" });
  });

  it("keeps the columns older monthly files were written with in place", () => {
    const keys = REQUEST_COLUMNS.map((c) => c.key);
    expect(keys.indexOf("event_id")).toBe(11);
    expect(keys.slice(-3)).toEqual(["customer_note", "measure", "category"]);
  });

  it("writes the item's category on request and total rows", () => {
    const ws = fakeSheet();
    addRequestRows(ws, [{
      event_id: "e1", event_name: "ארוחת ערב", needed_on: null, needed_by: null, company_name: "פלוגה א", supplier_name: "מטבח",
      item_name: "עגבניה", item_category: "ירקות ופירות", quantity: 3, supplied_quantity: null, status: "pending", urgent: false,
      supplier_note: null, customer_note: null, updated_at: "2026-10-27T08:00:00Z", measure: null,
    }]);
    expect(ws.rows[0]).toMatchObject({ item: "עגבניה", category: "ירקות ופירות" });

    const totals = fakeSheet();
    fillTotalsSheet(totals, [
      { item_name: "עגבניה", category: "ירקות ופירות", supplier_name: "מטבח", quantity: 3, measure: null },
      { item_name: "מלח", category: null, supplier_name: "מטבח", quantity: 1, measure: null },
    ]);
    expect(totals.rows.map((r) => r.category)).toEqual(["ירקות ופירות", ""]);
  });
});
