import { describe, expect, it } from "vitest";
import { makeProfile } from "../test/fixtures";
import { awaitsApprovalFrom, moveTargetsOf, supplierUnitsOf, unitKindOf, unitNamesOf, unitsOf, workUnitsOf } from "./userUnits";

const cook = makeProfile({ role: "supplier", unit_id: "kitchen", supplier_ids: ["kitchen"], pending_supplier_ids: ["closing"] });

describe("unitsOf and workUnitsOf", () => {
  it("is every supplier unit of a supplier, and only the approved ones to work in", () => {
    expect(unitsOf(cook)).toEqual(["kitchen", "closing"]);
    expect(workUnitsOf(cook)).toEqual(["kitchen"]);
  });

  it("is the company of a customer and nothing for an admin", () => {
    expect(unitsOf(makeProfile({ unit_id: "a" }))).toEqual(["a"]);
    expect(unitsOf(makeProfile({ role: "admin", unit_id: null }))).toEqual([]);
  });
});

describe("unitKindOf", () => {
  it("puts customers in companies and suppliers in logistic platoons", () => {
    expect(unitKindOf("customer")).toBe("company");
    expect(unitKindOf("supplier")).toBe("supplier");
  });
});

describe("unitNamesOf", () => {
  it("names every unit of the user and marks those still to approve", () => {
    const units = [{ id: "kitchen", name: "מטבח" }, { id: "closing", name: "סגירות" }]
      .map((u) => ({ ...u, kind: "supplier" as const, headcount: null, active: true }));
    expect(unitNamesOf(cook, units)).toBe("מטבח, סגירות (ממתין לאישור)");
  });
});

describe("awaitsApprovalFrom", () => {
  const recruit = makeProfile({ approval: "pending", unit_id: "a" });

  it("shows a pending customer to admins and to its company's super user only", () => {
    expect(awaitsApprovalFrom(recruit, null)).toBe(true);
    expect(awaitsApprovalFrom(recruit, ["a"])).toBe(true);
    expect(awaitsApprovalFrom(recruit, ["b"])).toBe(false);
  });

  it("shows an approved supplier to the super users of the units still to approve it", () => {
    expect(awaitsApprovalFrom(cook, ["closing"])).toBe(true);
    expect(awaitsApprovalFrom(cook, ["kitchen"])).toBe(false);
    expect(awaitsApprovalFrom(cook, null)).toBe(true);
  });

  it("never shows a rejected user", () => {
    expect(awaitsApprovalFrom({ ...recruit, approval: "rejected" }, null)).toBe(false);
  });
});

describe("supplierUnitsOf and moveTargetsOf", () => {
  const units = [
    { id: "store", name: "אפסנאות", active: true }, { id: "kitchen", name: "מטבח", active: true },
    { id: "old", name: "ישנה", active: false }, { id: "medic", name: "רפואה", active: true },
  ].map((u) => ({ ...u, kind: "supplier" as const, headcount: null }));
  const both = makeProfile({ role: "supplier", unit_id: "store", supplier_ids: ["kitchen", "store", "old"] });

  it("lists the units the supplier works in, in the units list's order", () => {
    expect(supplierUnitsOf(both, units).map((u) => u.id)).toEqual(["store", "kitchen", "old"]);
  });

  it("moves items only to another active unit of the supplier", () => {
    expect(moveTargetsOf(both, units, "store").map((u) => u.id)).toEqual(["kitchen"]);
    expect(moveTargetsOf(makeProfile({ role: "supplier", unit_id: "store", supplier_ids: ["store"] }), units, "store")).toEqual([]);
  });
});
