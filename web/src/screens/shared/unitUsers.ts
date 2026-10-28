// What a super user manages. The server returns only the users of their
// units; this splits them into those waiting for the super user's approval
// and the active soldiers of their units.
import type { Profile } from "../../lib/types";
import { awaitsApprovalFrom, workUnitsOf } from "../../lib/userUnits";
import { t } from "../../strings";

export const UNIT_USERS_PATH = "/unit-users";

/** The home screen tab to the unit's soldiers, for super users only. */
export const unitUsersNav = (profile: Profile) =>
  profile.super_user ? [{ to: UNIT_USERS_PATH, label: t.unitUsers[profile.role] }] : [];

/** Users waiting for my approval, and active users working in my units, me first, then by name. */
export function splitUnitUsers(users: Profile[], me: Profile) {
  const mine = workUnitsOf(me);
  const fullName = (u: Profile) => `${u.first_name} ${u.last_name}`;
  return {
    pending: users.filter((u) => awaitsApprovalFrom(u, mine)),
    members: users
      .filter((u) => u.approval === "approved" && u.active && workUnitsOf(u).some((id) => mine.includes(id)))
      .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || fullName(a).localeCompare(fullName(b), "he")),
  };
}
