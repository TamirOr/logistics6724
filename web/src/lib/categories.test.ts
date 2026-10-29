import { describe, expect, it } from "vitest";
import { categoryToAdd, groupByCategory, hasCategories } from "./categories";

const rows = [
  { name: "עגבניה", category: "ירקות ופירות" },
  { name: "חלב", category: "מוצרי חלב" },
  { name: "מלח", category: null },
  { name: "גבינה לבנה", category: "מוצרי חלב" },
  { name: "תפוז", category: "ירקות ופירות" },
];

describe("groupByCategory", () => {
  it("groups alphabetically with the general group last, keeping the order within a group", () => {
    const groups = groupByCategory(rows, (r) => r.category);
    expect(groups.map((g) => [g.category, g.rows.map((r) => r.name)])).toEqual([
      ["ירקות ופירות", ["עגבניה", "תפוז"]],
      ["מוצרי חלב", ["חלב", "גבינה לבנה"]],
      [null, ["מלח"]],
    ]);
    expect(hasCategories(groups)).toBe(true);
  });

  it("puts rows of an unknown item in the general group", () => {
    expect(groupByCategory([{ name: "x" }], () => undefined)).toEqual([{ category: null, rows: [{ name: "x" }] }]);
  });

  it("reads a list without categories as one plain list", () => {
    const groups = groupByCategory(rows.map((r) => ({ ...r, category: null })), (r) => r.category);
    expect(groups).toHaveLength(1);
    expect(hasCategories(groups)).toBe(false);
  });
});

describe("categoryToAdd", () => {
  it("adds the trimmed category to an item without one", () => {
    expect(categoryToAdd(null, "  מוצרי חלב ")).toBe("מוצרי חלב");
  });

  it("adds nothing for blank text", () => {
    expect(categoryToAdd(null, "  ")).toBeNull();
  });

  it("leaves an item's existing category to the supplier", () => {
    expect(categoryToAdd("ירקות", "מוצרי חלב")).toBeNull();
  });
});
