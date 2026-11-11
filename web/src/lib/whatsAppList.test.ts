import { describe, expect, it } from "vitest";
import { makeRequest } from "../test/fixtures";
import type { Item } from "./types";
import { itemLine, whatsAppList } from "./whatsAppList";

const item = (id: string, name: string, category: string | null, supplier_id = "food"): Item =>
  ({ id, supplier_id, name, category, verified: true, active: true });
const items = new Map([
  item("cucumber", "מלפפון", "🥒 ירקות"),
  item("grapes", "ענבים", "🍇 פירות"),
  item("salt", "מלח", null),
  item("aa", "סוללות AA", null, "gear"),
].map((i) => [i.id, i]));
const suppliers = [{ id: "food", name: "מזון" }, { id: "gear", name: "אפסנאות" }];
const at = (minute: number) => `2026-11-11T08:${String(minute).padStart(2, "0")}:00Z`;
const rows = [
  makeRequest({ item_id: "grapes", supplier_id: "food", quantity: 2, created_at: at(1) }),
  makeRequest({ item_id: "cucumber", supplier_id: "food", quantity: 3, created_at: at(2) }),
  makeRequest({ item_id: "salt", supplier_id: "food", quantity: 1, created_at: at(3) }),
  makeRequest({ item_id: "aa", supplier_id: "gear", quantity: 20, created_at: at(4) }),
];
const base = { eventName: "יום שלישי", companyName: "פלוגה ב׳", rows, suppliers, itemOf: (id: string) => items.get(id) };

describe("whatsAppList", () => {
  it("lists each supplier under its title, by category, the general group last", () => {
    expect(whatsAppList({ ...base, bySupplier: true })).toBe([
      "דרישות מבצע לוגיסטי – יום שלישי | פלוגה ב׳",
      "*מזון*\n🍇 פירות:\n• ענבים – 2\n\n🥒 ירקות:\n• מלפפון – 3\n\nכללי:\n• מלח – 1",
      "*אפסנאות*\n• סוללות AA – 20",
    ].join("\n\n"));
  });

  it("merges the suppliers into one list by category only", () => {
    expect(whatsAppList({ ...base, bySupplier: false })).toBe([
      "דרישות מבצע לוגיסטי – יום שלישי | פלוגה ב׳",
      "🍇 פירות:\n• ענבים – 2\n\n🥒 ירקות:\n• מלפפון – 3\n\nכללי:\n• מלח – 1\n• סוללות AA – 20",
    ].join("\n\n"));
  });

  it("leaves out cancelled requests, items not loaded yet and suppliers with nothing", () => {
    const text = whatsAppList({
      ...base, bySupplier: true,
      rows: [rows[0], makeRequest({ item_id: "aa", supplier_id: "gear", status: "cancelled" }), makeRequest({ item_id: "unknown" })],
    });
    expect(text).toBe("דרישות מבצע לוגיסטי – יום שלישי | פלוגה ב׳\n\n*מזון*\n🍇 פירות:\n• ענבים – 2");
  });

  it("is only the title for an empty list", () => {
    expect(whatsAppList({ ...base, rows: [], bySupplier: false })).toBe("דרישות מבצע לוגיסטי – יום שלישי | פלוגה ב׳");
  });
});

describe("itemLine", () => {
  const rice = item("rice", "אורז", null);
  it("adds the measure and the company's note", () => {
    expect(itemLine(makeRequest({ quantity: 2, measure: "שקים", customer_note: " בסמטי " }), rice)).toBe("• אורז – 2 שקים (בסמטי)");
  });
  it("shows the bare quantity with no measure or note", () => {
    expect(itemLine(makeRequest({ quantity: 6, customer_note: "  " }), rice)).toBe("• אורז – 6");
  });
});
