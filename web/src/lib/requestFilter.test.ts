import { describe, expect, it } from "vitest";
import { makeRequest } from "../test/fixtures";
import { categoryOptions, filterRequests, GENERAL_CATEGORY, isFiltering, NO_FILTER } from "./requestFilter";

const categories: Record<string, string | null> = { milk: "מוצרי חלב", tomato: "ירקות", salt: null };
const categoryOf = (r: { item_id: string }) => categories[r.item_id];
const rows = [
  makeRequest({ item_id: "milk", status: "missing" }),
  makeRequest({ item_id: "tomato", status: "ready" }),
  makeRequest({ item_id: "salt", status: "missing" }),
  makeRequest({ item_id: "milk", status: "pending" }),
];
const items = (list: { item_id: string; status: string }[]) => list.map((r) => `${r.item_id}:${r.status}`);

describe("filterRequests", () => {
  it("keeps every row with no filter", () => {
    expect(filterRequests(rows, NO_FILTER, categoryOf)).toEqual(rows);
    expect(isFiltering(NO_FILTER)).toBe(false);
  });

  it("filters by status", () => {
    expect(items(filterRequests(rows, { category: "", status: "missing" }, categoryOf))).toEqual(["milk:missing", "salt:missing"]);
  });

  it("filters by category, the general group included", () => {
    expect(items(filterRequests(rows, { category: "מוצרי חלב", status: "" }, categoryOf))).toEqual(["milk:missing", "milk:pending"]);
    expect(items(filterRequests(rows, { category: GENERAL_CATEGORY, status: "" }, categoryOf))).toEqual(["salt:missing"]);
  });

  it("combines both filters", () => {
    expect(items(filterRequests(rows, { category: "מוצרי חלב", status: "missing" }, categoryOf))).toEqual(["milk:missing"]);
  });
});

describe("categoryOptions", () => {
  it("lists the used categories alphabetically, the general group last", () => {
    expect(categoryOptions(rows, categoryOf)).toEqual(["ירקות", "מוצרי חלב", GENERAL_CATEGORY]);
  });

  it("offers nothing when no row has a category", () => {
    expect(categoryOptions([makeRequest({ item_id: "salt" })], categoryOf)).toEqual([]);
  });
});
