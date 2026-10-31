// Editing the sign-up details (ProfileDraft) on the sign-up form and on an
// admin's new user form.
import type { ProfileDraft } from "./types";

export const EMPTY_DRAFT: ProfileDraft = { firstName: "", lastName: "", serviceNumber: "", role: "customer", unitIds: [] };

/** Units are of one side only, so changing side clears them. */
export const withSide = (draft: ProfileDraft, role: ProfileDraft["role"]): ProfileDraft =>
  draft.role === role ? draft : { ...draft, role, unitIds: [] };

/** Ticks or unticks a supplier unit. The first picked stays the main unit. */
export function withUnit(draft: ProfileDraft, id: string, on: boolean): ProfileDraft {
  if (on === draft.unitIds.includes(id)) return draft;
  return { ...draft, unitIds: on ? [...draft.unitIds, id] : draft.unitIds.filter((x) => x !== id) };
}
