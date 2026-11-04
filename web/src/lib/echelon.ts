// Echelons: a company user is in the front (opens events, fills the lists)
// or the rear (picks the items up and marks them). The server enforces what
// each may do; this picks the screens and names the writer of a comment or
// a status.
import type { Echelon, Profile } from "./types";
import { t } from "../strings";

/** A profile cached by an earlier build has no echelon: everyone was in the front. */
export const echelonOf = (profile: Profile): Echelon => profile.echelon ?? "front";

export const otherEchelon = (profile: Profile): Echelon => (echelonOf(profile) === "front" ? "rear" : "front");

/** The rear works on its company's requests the way a supplier works on its own. */
export const isRear = (profile: Profile): boolean => profile.role === "customer" && echelonOf(profile) === "rear";

/** The set of screens a user works in: their role's, or the rear's. */
export type Screens = Profile["role"] | "rear";
export const screensOf = (profile: Profile): Screens => (isRear(profile) ? "rear" : profile.role);

/** Who wrote or marked something: the unit, and on the company side the echelon ("פלוגה א · מפלג אחורי"). */
export const writerLabel = (unitName: string, echelon: Echelon | null | undefined): string =>
  echelon ? `${unitName} · ${t.echelonLabels[echelon]}` : unitName;
