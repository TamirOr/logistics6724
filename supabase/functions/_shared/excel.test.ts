import { describe, expect, it } from "vitest";
import { addRequestRows, REQUEST_COLUMNS, setupRequestSheet } from "./excel.ts";

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
    expect(visible).toHaveLength(12);
    expect(visible.map((c) => c.key)).toContain("supplied");
  });

  it("writes Hebrew status labels, the urgent mark and the short time", () => {
    const ws = fakeSheet();
    addRequestRows(ws, [{
      event_id: "e1", event_name: "תרגיל", needed_on: "2026-11-03", needed_by: "22:00:00", company_name: "פלוגה א", supplier_name: "מטבח",
      item_name: "ארגז מנות", quantity: 5, supplied_quantity: 3, status: "partial", urgent: true,
      supplier_note: null, customer_note: null, updated_at: "2026-10-27T08:00:00Z",
    }]);
    expect(ws.rows[0]).toMatchObject({ needed_by: "יום שלישי, 3.11 · 22:00", status: "חלקי", urgent: "כן", supplied: 3, note: "", customer_note: "" });
  });

  it("keeps the columns older monthly files were written with in place", () => {
    const keys = REQUEST_COLUMNS.map((c) => c.key);
    expect(keys.indexOf("event_id")).toBe(11);
    expect(keys.at(-1)).toBe("customer_note");
  });
});
