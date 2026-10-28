// The units a user belongs to, wherever a user's units are shown.
import type { Profile, Unit } from "./types";

/** A supplier's supplier units, or the one unit of anyone else. */
export const unitsOf = (user: Profile): string[] =>
  user.role === "supplier" ? user.supplier_ids : user.unit_id ? [user.unit_id] : [];

export const unitNamesOf = (user: Profile, units: Unit[]): string =>
  unitsOf(user).map((id) => units.find((u) => u.id === id)?.name ?? "").join(", ");
