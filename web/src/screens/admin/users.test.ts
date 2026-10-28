import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, filterUsers, NO_FILTER, toggleUnit } from "./users";
import { makeProfile } from "../../test/fixtures";

const cook = makeProfile({ role: "supplier", unit_id: "kitchen", supplier_ids: ["kitchen", "closing"] });
const storekeeper = makeProfile({ role: "supplier", unit_id: "stores", supplier_ids: ["stores"], active: false });
const mainUnits = (users: ReturnType<typeof makeProfile>[]) => users.map((u) => u.unit_id);

describe("filterUsers", () => {
  const users = [cook, storekeeper];

  it("keeps everyone with no filter", () => {
    expect(filterUsers(users, NO_FILTER)).toEqual(users);
  });

  it("shows only active users by default", () => {
    expect(filterUsers(users, DEFAULT_FILTER)).toEqual([cook]);
  });

  it("keeps a user in any of the picked units, including a second supplier unit", () => {
    expect(mainUnits(filterUsers(users, { ...NO_FILTER, unitIds: ["closing"] }))).toEqual(["kitchen"]);
    expect(mainUnits(filterUsers(users, { ...NO_FILTER, unitIds: ["closing", "stores"] }))).toEqual(["kitchen", "stores"]);
  });

  it("filters by active and inactive", () => {
    expect(mainUnits(filterUsers(users, { ...NO_FILTER, active: "active" }))).toEqual(["kitchen"]);
    expect(mainUnits(filterUsers(users, { ...NO_FILTER, active: "inactive" }))).toEqual(["stores"]);
  });

  it("combines both filters", () => {
    expect(filterUsers(users, { unitIds: ["kitchen"], active: "inactive" })).toEqual([]);
  });
});

describe("toggleUnit", () => {
  it("adds a unit and removes it again", () => {
    const once = toggleUnit(NO_FILTER, "kitchen");
    expect(once.unitIds).toEqual(["kitchen"]);
    expect(toggleUnit(once, "kitchen").unitIds).toEqual([]);
  });
});
