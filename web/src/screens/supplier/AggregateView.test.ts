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
  aa: { id: "aa", supplier_id: "supplier", name: "סוללה AA", verified: true, active: true },
  jerry: { id: "jerry", supplier_id: "supplier", name: "ג׳ריקן מים", verified: true, active: true },
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
      itemId: "aa", item_name: "סוללה AA", supplier_name: "אפסנאות", quantity: 45,
      byCompany: [{ company: "פלוגה א", quantity: 30 }, { company: "פלוגה ב", quantity: 15 }],
    }]);
  });
});
