import { describe, expect, it } from "vitest";
import { makeRequest } from "../test/fixtures";
import type { ItemMatch } from "./api";
import type { Item } from "./types";
import { chooseMatch, isAlreadyListed, parseItem, parseWhatsAppList, type ImportedLine } from "./whatsAppImport";
import { whatsAppList } from "./whatsAppList";

const suppliers = [{ id: "food", name: "מזון" }, { id: "gear", name: "אפסנאות" }];

describe("parseItem", () => {
  it.each([
    ["מלפפון – 3", { name: "מלפפון", quantity: 3, measure: null, note: null }],
    ["בטטה - 2", { name: "בטטה", quantity: 2, measure: null, note: null }],
    ["תפוחי אדמה - 2 שקים", { name: "תפוחי אדמה", quantity: 2, measure: "שקים", note: null }],
    ["אורז – *20*", { name: "אורז", quantity: 20, measure: null, note: null }],
    ["לחמניות - *6 ארגזים*", { name: "לחמניות", quantity: 6, measure: "ארגזים", note: null }],
    ["טחינה – 2 קרטונים של טחינה לחיצה", { name: "טחינה", quantity: 2, measure: "קרטונים", note: "של טחינה לחיצה" }],
    ["שום טרי (אם אין, אז כתוש)", { name: "שום טרי", quantity: null, measure: null, note: "אם אין, אז כתוש" }],
    ["מעדנים – מילקי, דנונה וכל מה שיש מפנק", { name: "מעדנים", quantity: null, measure: null, note: "מילקי, דנונה וכל מה שיש מפנק" }],
    ["סוללות אצבע (AA) – 20", { name: "סוללות אצבע (AA)", quantity: 20, measure: null, note: null }],
    ["25 סוללות aaa", { name: "סוללות aaa", quantity: 25, measure: null, note: null }],
    ["מלפפון 3", { name: "מלפפון", quantity: 3, measure: null, note: null }],
    ["חסה", { name: "חסה", quantity: null, measure: null, note: null }],
    ["אורז – 2 שקים (בסמטי)", { name: "אורז", quantity: 2, measure: "שקים", note: "בסמטי" }],
    ["מים – 0", { name: "מים", quantity: 1, measure: null, note: null }],
  ])("%s", (text, expected) => {
    expect(parseItem(text)).toEqual(expected);
  });

  it("drops a line with no name", () => {
    expect(parseItem("*  *")).toBeNull();
  });
});

describe("parseWhatsAppList", () => {
  const message = [
    "דרישות מבצע לוגיסטי – יום שלישי | תקיפה ב׳ בגדס״ר 9",
    "",
    "🥒 ירקות:",
    "• מלפפון – 3",
    "• שום טרי (אם אין, אז כתוש)",
    "",
    "",
    "קפואים",
    "• צ׳יפס – 6",
    "",
    "🔋 סוללות:",
    "• סוללות אצבע (AA) – 20",
    "* 25 סוללות aaa",
    "• 20 סוללות ליראור ליתיום",
    "",
    "לוגיסטיקה",
    "* שקיות קקי",
  ].join("\n");

  it("reads the user's message: categories above bullets, the first line is no category", () => {
    const lines = parseWhatsAppList(message, suppliers);
    expect(lines.map((l) => [l.name, l.quantity, l.category])).toEqual([
      ["מלפפון", 3, "🥒 ירקות"],
      ["שום טרי", null, "🥒 ירקות"],
      ["צ׳יפס", 6, "קפואים"],
      ["סוללות אצבע (AA)", 20, "🔋 סוללות"],
      ["סוללות aaa", 25, "🔋 סוללות"],
      ["סוללות ליראור ליתיום", 20, "🔋 סוללות"],
      ["שקיות קקי", null, "לוגיסטיקה"],
    ]);
    expect(lines.every((l) => l.supplierId === null)).toBe(true);
  });

  it("puts lines under a supplier's title in that supplier", () => {
    const lines = parseWhatsAppList("*מזון*\nירקות:\n• מלפפון – 3\n\n*אפסנאות*\n• סוללות AA – 20", suppliers);
    expect(lines.map((l) => [l.name, l.supplierId, l.category])).toEqual([
      ["מלפפון", "food", "ירקות"],
      ["סוללות AA", "gear", null],
    ]);
  });

  it("reads a list typed with no bullets as one item per line", () => {
    const lines = parseWhatsAppList("ירקות:\nמלפפון 3\nחסה", suppliers);
    expect(lines.map((l) => [l.name, l.quantity, l.category])).toEqual([["מלפפון", 3, "ירקות"], ["חסה", null, "ירקות"]]);
  });

  it("reads back what העתקה לוואטסאפ writes", () => {
    const item = (id: string, name: string, category: string | null, supplier_id: string): Item =>
      ({ id, supplier_id, name, category, verified: true, active: true });
    const items = new Map([item("rice", "אורז", "🍚 יבשים", "food"), item("aa", "סוללות AA", null, "gear")].map((i) => [i.id, i]));
    const text = whatsAppList({
      eventName: "יום שלישי", companyName: "פלוגה ב׳", suppliers, itemOf: (id) => items.get(id), bySupplier: true,
      rows: [
        makeRequest({ item_id: "rice", supplier_id: "food", quantity: 2, measure: "שקים", customer_note: "בסמטי" }),
        makeRequest({ item_id: "aa", supplier_id: "gear", quantity: 20 }),
      ],
    });
    expect(parseWhatsAppList(text, suppliers)).toEqual([
      { name: "אורז", quantity: 2, measure: "שקים", note: "בסמטי", category: "🍚 יבשים", supplierId: "food" },
      { name: "סוללות AA", quantity: 20, measure: null, note: null, category: null, supplierId: "gear" },
    ]);
  });
});

describe("chooseMatch", () => {
  const line = (overrides: Partial<ImportedLine> = {}): ImportedLine =>
    ({ name: "מלפפון", quantity: null, measure: null, note: null, category: null, supplierId: null, ...overrides });
  const match = (id: string, exact: boolean, overrides: Partial<ItemMatch> = {}): ItemMatch =>
    ({ id, name: id, exact, default_quantity: null, measures: [], default_measure: null, ...overrides });
  const order = ["food", "gear"];

  it("takes the first supplier with an exact match over an earlier 'did you mean'", () => {
    const matches = new Map([["food", [match("cucumber-ish", false)]], ["gear", [match("cucumber", true)]]]);
    expect(chooseMatch(line(), matches, order)).toMatchObject({ supplierId: "gear", itemId: "cucumber" });
  });

  it("falls back to the first 'did you mean', then to a new item", () => {
    expect(chooseMatch(line(), new Map([["gear", [match("near", false)]]]), order))
      .toMatchObject({ supplierId: "gear", itemId: "near" });
    expect(chooseMatch(line(), new Map(), order)).toEqual({ supplierId: null, itemId: null, quantity: 1, measure: "" });
  });

  it("keeps a line to the supplier it sat under", () => {
    const matches = new Map([["food", [match("cucumber", true)]]]);
    expect(chooseMatch(line({ supplierId: "gear" }), matches, order))
      .toEqual({ supplierId: "gear", itemId: null, quantity: 1, measure: "" });
  });

  it("takes the company's last quantity and measure only where the message gave none", () => {
    const matches = new Map([["food", [match("rice", true, { default_quantity: 5, default_measure: "שק" })]]]);
    expect(chooseMatch(line(), matches, order)).toMatchObject({ quantity: 5, measure: "שק" });
    expect(chooseMatch(line({ quantity: 2, measure: "קילו" }), matches, order)).toMatchObject({ quantity: 2, measure: "קילו" });
  });
});

describe("isAlreadyListed", () => {
  it("is true only for an open request of the same item", () => {
    const rows = [makeRequest({ item_id: "a" }), makeRequest({ item_id: "b", status: "cancelled" }), makeRequest({ item_id: "c", status: "collected" })];
    expect(isAlreadyListed("a", rows)).toBe(true);
    expect(isAlreadyListed("b", rows)).toBe(false);
    expect(isAlreadyListed("c", rows)).toBe(false);
    expect(isAlreadyListed(null, rows)).toBe(false);
  });
});
