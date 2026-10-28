// Users as admins see them: their units, and the filters of the users
// tables, by unit (any of the picked ones) and by whether the user is active.
import type { Profile, Unit } from "../../lib/types";

export type ActiveFilter = "all" | "active" | "inactive";
export interface UserFilter { unitIds: string[]; active: ActiveFilter }
export const NO_FILTER: UserFilter = { unitIds: [], active: "all" };
// Tables open on active users: inactive ones are kept only for history.
export const DEFAULT_FILTER: UserFilter = { ...NO_FILTER, active: "active" };

/** A supplier's supplier units, or the one unit of anyone else. */
export const unitsOf = (user: Profile): string[] =>
  user.role === "supplier" ? user.supplier_ids : user.unit_id ? [user.unit_id] : [];

export const unitNamesOf = (user: Profile, units: Unit[]): string =>
  unitsOf(user).map((id) => units.find((u) => u.id === id)?.name ?? "").join(", ");

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
