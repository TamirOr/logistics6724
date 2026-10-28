// What a super user manages. The server returns only the users of their
// units; this splits them into sign-ups and active members.
import type { Profile } from "../../lib/types";

export const UNIT_USERS_PATH = "/unit-users";

/** The home screen tab to the unit's users, for super users only. */
export const unitUsersNav = (profile: Profile, label: string) =>
  profile.super_user ? [{ to: UNIT_USERS_PATH, label }] : [];

/** Sign-ups waiting for approval, and active members with the super user first, then by name. */
export function splitUnitUsers(users: Profile[], meId: string) {
  const fullName = (u: Profile) => `${u.first_name} ${u.last_name}`;
  return {
    pending: users.filter((u) => u.approval === "pending"),
    members: users
      .filter((u) => u.approval === "approved" && u.active)
      .sort((a, b) => Number(b.id === meId) - Number(a.id === meId) || fullName(a).localeCompare(fullName(b), "he")),
  };
}
