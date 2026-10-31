import { describe, expect, it } from "vitest";
import { makeProfile } from "../test/fixtures";
import type { Unit, UserInvite } from "./types";
import { awaitsApprovalFrom, inviteUnitNamesOf, unitKindOf, unitNamesOf, unitsOf, workUnitsOf } from "./userUnits";

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

describe("inviteUnitNamesOf", () => {
  const units: Unit[] = [
    { id: "kitchen", name: "מטבח", kind: "supplier", headcount: null, active: true },
    { id: "closing", name: "סגירה", kind: "supplier", headcount: null, active: true },
    { id: "a", name: "פלוגה א׳", kind: "company", headcount: 120, active: true },
  ];
  const invite = (overrides: Partial<UserInvite>): UserInvite => ({
    email: "new@example.com", first_name: "נועה", last_name: "בר", service_number: "1234567",
    role: "customer", unit_id: "a", supplier_ids: [], created_at: "2026-10-31T08:00:00Z", ...overrides,
  });

  it("names every supplier unit of an invited supplier", () => {
    expect(inviteUnitNamesOf(invite({ role: "supplier", unit_id: "kitchen", supplier_ids: ["kitchen", "closing"] }), units))
      .toBe("מטבח, סגירה");
  });

  it("names the company of an invited customer", () => {
    expect(inviteUnitNamesOf(invite({}), units)).toBe("פלוגה א׳");
  });
});
