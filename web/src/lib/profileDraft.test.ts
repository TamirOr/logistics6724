import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, withSide, withUnit } from "./profileDraft";

describe("withSide", () => {
  it("clears the units when the side changes", () => {
    const customer = { ...EMPTY_DRAFT, firstName: "נועה", unitIds: ["company-a"] };
    expect(withSide(customer, "supplier")).toEqual({ ...customer, role: "supplier", unitIds: [] });
  });

  it("keeps the units when the side stays", () => {
    const customer = { ...EMPTY_DRAFT, unitIds: ["company-a"] };
    expect(withSide(customer, "customer")).toBe(customer);
  });
});

describe("withUnit", () => {
  const supplier = { ...EMPTY_DRAFT, role: "supplier" as const };

  it("keeps the first picked unit first, as the main unit", () => {
    const picked = withUnit(withUnit(supplier, "kitchen", true), "closing", true);
    expect(picked.unitIds).toEqual(["kitchen", "closing"]);
    expect(withUnit(picked, "kitchen", true)).toBe(picked);
  });

  it("unticks a unit", () => {
    expect(withUnit({ ...supplier, unitIds: ["kitchen", "closing"] }, "kitchen", false).unitIds).toEqual(["closing"]);
  });
});
