import { describe, expect, it } from "vitest";
import { makeProfile } from "../../test/fixtures";
import { splitUnitUsers, unitUsersNav } from "./unitUsers";

describe("splitUnitUsers", () => {
  const me = makeProfile({ first_name: "תמר", super_user: true, unit_id: "a" });
  const avi = makeProfile({ first_name: "אבי", unit_id: "a" });
  const waiting = makeProfile({ first_name: "גל", approval: "pending", unit_id: "a" });
  const rejected = makeProfile({ first_name: "דן", approval: "rejected", unit_id: "a" });
  const removed = makeProfile({ first_name: "הדר", active: false, unit_id: "a" });

  it("puts sign-ups waiting for me apart", () => {
    expect(splitUnitUsers([me, waiting, avi], me).pending).toEqual([waiting]);
  });

  it("lists active approved members, the super user first, then by name", () => {
    expect(splitUnitUsers([avi, rejected, removed, me, waiting], me).members).toEqual([me, avi]);
  });

  it("splits a supplier by unit: waiting in mine, working in another", () => {
    const armorer = makeProfile({ role: "supplier", unit_id: "armory", supplier_ids: ["armory"], super_user: true });
    const cook = makeProfile({ role: "supplier", unit_id: "kitchen", supplier_ids: ["kitchen"], pending_supplier_ids: ["armory"] });
    expect(splitUnitUsers([armorer, cook], armorer)).toEqual({ pending: [cook], members: [armorer] });
  });
});

describe("unitUsersNav", () => {
  it("shows super users the tab named for their side", () => {
    expect(unitUsersNav(makeProfile({ super_user: true }))).toEqual([{ to: "/unit-users", label: "חיילי הפלוגה" }]);
    expect(unitUsersNav(makeProfile({ role: "supplier", super_user: true }))[0].label).toBe("חיילי המחלקה");
    expect(unitUsersNav(makeProfile())).toEqual([]);
  });
});
