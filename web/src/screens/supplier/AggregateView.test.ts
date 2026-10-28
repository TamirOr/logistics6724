import { describe, expect, it } from "vitest";
import { makeRequest } from "../../test/fixtures";
import type { Item, Unit } from "../../lib/types";
import { aggregateTotals } from "./AggregateView";

const units: Unit[] = [
  { id: "c1", name: "פלוגה א", kind: "company", headcount: 120, active: true },
  { id: "c2", name: "פלוגה ב", kind: "company", headcount: null, active: true },
  { id: "supplier", name: "אפסנאות", kind: "supplier", headcount: null, active: true },
];
const items: Record<string, Item> = {
  aa: { id: "aa", supplier_id: "supplier", name: "סוללה AA", category: "חשמל", verified: true, active: true },
  jerry: { id: "jerry", supplier_id: "supplier", name: "ג׳ריקן מים", category: null, verified: true, active: true },
};

describe("aggregateTotals", () => {
  it("sums each item across companies with the per-company split, skipping cancelled", () => {
    const totals = aggregateTotals([
      makeRequest({ item_id: "aa", company_id: "c1", quantity: 30 }),
      makeRequest({ item_id: "aa", company_id: "c2", quantity: 10 }),
      makeRequest({ item_id: "aa", company_id: "c2", quantity: 5 }),
      makeRequest({ item_id: "jerry", company_id: "c1", quantity: 20, status: "cancelled" }),
    ], (id) => items[id], units);

    expect(totals).toEqual([{
      key: "aa:", item_name: "סוללה AA", category: "חשמל", supplier_name: "אפסנאות", quantity: 45, measure: null,
      byCompany: [{ company: "פלוגה א", quantity: 30 }, { company: "פלוגה ב", quantity: 15 }],
    }]);
  });

  it("totals each measure of an item on its own row", () => {
    const totals = aggregateTotals([
      makeRequest({ item_id: "jerry", company_id: "c1", quantity: 2, measure: "קרטון" }),
      makeRequest({ item_id: "jerry", company_id: "c2", quantity: 3, measure: "קרטון" }),
      makeRequest({ item_id: "jerry", company_id: "c1", quantity: 20, measure: "ליטר" }),
      makeRequest({ item_id: "jerry", company_id: "c2", quantity: 1 }),
    ], (id) => items[id], units);

    expect(totals.map((x) => [x.measure, x.quantity])).toEqual([[null, 1], ["ליטר", 20], ["קרטון", 5]]);
  });
});
