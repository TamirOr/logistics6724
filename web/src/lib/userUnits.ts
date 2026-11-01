// The units a user belongs to, wherever a user's units are shown, and which
// of them still have to approve the user. Each unit approves on its own;
// the server decides, this only shows it.
import type { Profile, Unit, UnitKind, UserRole } from "./types";
import { t } from "../strings";

// A profile cached by an earlier build may lack the supplier lists.
const pendingOf = (user: Profile): string[] => (user.role === "supplier" ? user.pending_supplier_ids ?? [] : []);

/** The kind of unit a user of this role belongs to. */
export const unitKindOf = (role: UserRole): UnitKind => (role === "customer" ? "company" : "supplier");

/** The units a user works in: a supplier's approved supplier units, or the one unit of anyone else. */
export const workUnitsOf = (user: Profile): string[] =>
  user.role === "supplier" ? user.supplier_ids ?? [] : user.unit_id ? [user.unit_id] : [];

/** Every unit of the user, a supplier's units still to approve them included. */
export const unitsOf = (user: Profile): string[] => [...workUnitsOf(user), ...pendingOf(user)];

/** The supplier units the user works in, in the units list's order. */
export const supplierUnitsOf = (user: Profile, units: Unit[]): Unit[] =>
  units.filter((u) => user.supplier_ids?.includes(u.id));

/** Where the user may move catalog items from one of their units: their other active units. */
export const moveTargetsOf = (user: Profile, units: Unit[], from: string): Unit[] =>
  supplierUnitsOf(user, units).filter((u) => u.id !== from && u.active);

export const unitNamesOf = (user: Profile, units: Unit[]): string =>
  unitsOf(user).map((id) => {
    const name = units.find((u) => u.id === id)?.name ?? "";
    return pendingOf(user).includes(id) ? t.pendingUnit(name) : name;
  }).join(", ");

/**
 * The user waits for an approval the viewer can give: an admin (null
 * units) any sign-up, a super user one waiting in a unit they work in.
 */
export function awaitsApprovalFrom(user: Profile, viewerUnits: string[] | null): boolean {
  if (user.approval === "rejected") return false;
  const waiting = user.role === "supplier" ? pendingOf(user)
    : user.approval === "pending" && user.unit_id ? [user.unit_id] : [];
  return viewerUnits === null
    ? user.approval === "pending" || waiting.length > 0
    : waiting.some((id) => viewerUnits.includes(id));
}
