// An admin may work as a unit's customer or supplier (act_as_unit). The app
// then shows them that user's screens. This mirrors the server's my_role()
// and my_unit(), which enforce it; it only picks the screens.
import type { Profile, UnitKind, UserRole } from "./types";

const ROLE_IN: Record<UnitKind, UserRole> = { company: "customer", supplier: "supplier" };

/** The profile the screens work with: the user's own, or that of the unit an admin works in. */
export function workingProfile(profile: Profile): Profile {
  // A profile cached by an earlier build has no acting fields.
  if (profile.role !== "admin" || !profile.acting_unit_id || !profile.acting_kind) return profile;
  const role = ROLE_IN[profile.acting_kind];
  return {
    ...profile,
    role,
    unit_id: profile.acting_unit_id,
    supplier_ids: role === "supplier" ? [profile.acting_unit_id] : [],
    pending_supplier_ids: [],
    super_user: false,
  };
}

/** An admin working as a unit's user, who can return to admin. */
export const isAdminInUnit = (profile: Profile): boolean => workingProfile(profile).role !== profile.role;
