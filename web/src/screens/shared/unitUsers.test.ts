import { describe, expect, it } from "vitest";
import { makeProfile } from "../../test/fixtures";
import { splitUnitUsers, unitUsersNav } from "./unitUsers";

describe("splitUnitUsers", () => {
  const me = makeProfile({ first_name: "תמר", super_user: true });
  const avi = makeProfile({ first_name: "אבי" });
  const waiting = makeProfile({ first_name: "גל", approval: "pending" });
  const rejected = makeProfile({ first_name: "דן", approval: "rejected" });
  const removed = makeProfile({ first_name: "הדר", active: false });

  it("puts pending sign-ups apart", () => {
    expect(splitUnitUsers([me, waiting, avi], me.id).pending).toEqual([waiting]);
  });

  it("lists active approved members, the super user first, then by name", () => {
    expect(splitUnitUsers([avi, rejected, removed, me, waiting], me.id).members).toEqual([me, avi]);
  });
});

describe("unitUsersNav", () => {
  it("shows the tab to super users only", () => {
    expect(unitUsersNav(makeProfile({ super_user: true }), "x")).toHaveLength(1);
    expect(unitUsersNav(makeProfile(), "x")).toEqual([]);
  });
});
