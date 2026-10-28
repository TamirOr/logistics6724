import { describe, expect, it } from "vitest";
import { makeProfile } from "../test/fixtures";
import { isAdminInUnit, workingProfile } from "./workingProfile";

const admin = makeProfile({ role: "admin", unit_id: null });

describe("workingProfile", () => {
  it("keeps an admin working as admin", () => {
    expect(workingProfile(admin)).toBe(admin);
    expect(isAdminInUnit(admin)).toBe(false);
  });

  it("makes an admin in a company its customer", () => {
    const p = workingProfile({ ...admin, acting_unit_id: "company-a", acting_kind: "company" });
    expect(p).toMatchObject({ role: "customer", unit_id: "company-a", supplier_ids: [] });
  });

  it("makes an admin in a supplier unit its supplier, in that unit only", () => {
    const inUnit = { ...admin, acting_unit_id: "kitchen", acting_kind: "supplier" as const };
    expect(workingProfile(inUnit)).toMatchObject({ role: "supplier", unit_id: "kitchen", supplier_ids: ["kitchen"] });
    expect(isAdminInUnit(inUnit)).toBe(true);
  });

  it("returns an admin whose unit was deactivated to admin", () => {
    expect(workingProfile({ ...admin, acting_unit_id: "closed", acting_kind: null })).toMatchObject({ role: "admin" });
  });

  it("leaves other users as they are", () => {
    const customer = makeProfile({ acting_unit_id: "company-b", acting_kind: "company" });
    expect(workingProfile(customer)).toBe(customer);
    expect(isAdminInUnit(customer)).toBe(false);
  });

  it("reads a profile cached by an earlier build", () => {
    const { acting_unit_id: _, acting_kind: __, ...old } = admin;
    expect(workingProfile(old as typeof admin)).toBe(old);
  });
});
