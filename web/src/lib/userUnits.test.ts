import { describe, expect, it } from "vitest";
import { makeProfile } from "../test/fixtures";
import { unitNamesOf, unitsOf } from "./userUnits";

const cook = makeProfile({ role: "supplier", unit_id: "kitchen", supplier_ids: ["kitchen", "closing"] });

describe("unitsOf", () => {
  it("is every supplier unit of a supplier", () => {
    expect(unitsOf(cook)).toEqual(["kitchen", "closing"]);
  });

  it("is the company of a customer and nothing for an admin", () => {
    expect(unitsOf(makeProfile({ unit_id: "a" }))).toEqual(["a"]);
    expect(unitsOf(makeProfile({ role: "admin", unit_id: null }))).toEqual([]);
  });
});

describe("unitNamesOf", () => {
  it("names every unit of the user", () => {
    const units = [{ id: "kitchen", name: "מטבח" }, { id: "closing", name: "סגירות" }]
      .map((u) => ({ ...u, kind: "supplier" as const, headcount: null, active: true }));
    expect(unitNamesOf(cook, units)).toBe("מטבח, סגירות");
  });
});
