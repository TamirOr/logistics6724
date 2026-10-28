// The filters of the admin users tables: by unit (any of the picked ones)
// and by whether the user is active.
import type { Profile } from "../../lib/types";
import { unitsOf } from "../../lib/userUnits";

export type ActiveFilter = "all" | "active" | "inactive";
export interface UserFilter { unitIds: string[]; active: ActiveFilter }
export const NO_FILTER: UserFilter = { unitIds: [], active: "all" };

/** No unit picked means every unit. */
export function filterUsers(users: Profile[], filter: UserFilter): Profile[] {
  return users.filter((u) =>
    (filter.active === "all" || u.active === (filter.active === "active"))
    && (filter.unitIds.length === 0 || unitsOf(u).some((id) => filter.unitIds.includes(id))));
}

export const toggleUnit = (filter: UserFilter, unitId: string): UserFilter => ({
  ...filter,
  unitIds: filter.unitIds.includes(unitId) ? filter.unitIds.filter((id) => id !== unitId) : [...filter.unitIds, unitId],
});
