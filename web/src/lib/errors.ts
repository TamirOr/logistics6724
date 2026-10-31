import { t } from "../strings";

// Server reasons a user can act on, shown in Hebrew. Any other reason is
// shown as the server sent it, after the generic message, so it can be
// reported.
const KNOWN_REASONS: [RegExp, string][] = [
  [/items_active_name_unique/, t.errItemNameTaken],
  [/item is hidden by the supplier/, t.errItemHidden],
  [/item is used by requests/, t.errItemInUse],
  [/unit has users/, t.errUnitHasUsers],
  [/unit is used by events/, t.errUnitInUse],
  [/wrong join code/, t.errWrongJoinCode],
  [/email already has a user/, t.errEmailHasUser],
  [/daily limit of new items reached/, t.errDailyItemLimit],
  [/violates check constraint "\w+_length"/, t.errTooLong],
];

const reasonOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message ?? "").trim()
    : "";

/** Renaming or adding an item onto a name the supplier's catalog already has. */
export const isItemNameTaken = (error: unknown) => KNOWN_REASONS[0][0].test(reasonOf(error));

export function describeError(error: unknown, base: string = t.genericError): string {
  const reason = reasonOf(error);
  const known = KNOWN_REASONS.find(([pattern]) => pattern.test(reason));
  if (known) return known[1];
  return reason ? `${base} (${reason})` : base;
}
