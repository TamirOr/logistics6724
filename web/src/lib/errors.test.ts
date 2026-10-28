import { describe, expect, it } from "vitest";
import { describeError, isItemNameTaken } from "./errors";
import { t } from "../strings";

describe("describeError", () => {
  it("adds the server reason to the generic message", () => {
    // Supabase errors are plain objects with a message, not Error instances.
    expect(describeError({ message: "new row violates row-level security policy", code: "42501" }))
      .toBe(`${t.genericError} (new row violates row-level security policy)`);
    expect(describeError(new Error("boom"), t.rejectedChange)).toBe(`${t.rejectedChange} (boom)`);
  });

  it("falls back to the generic message without a reason", () => {
    expect(describeError(undefined)).toBe(t.genericError);
    expect(describeError({ message: "" })).toBe(t.genericError);
  });

  it("shows known server reasons in Hebrew instead of the raw text", () => {
    const taken = { code: "23505", message: 'duplicate key value violates unique constraint "items_active_name_unique"' };
    expect(describeError(taken)).toBe(t.errItemNameTaken);
    expect(isItemNameTaken(taken)).toBe(true);
    expect(describeError({ message: "item is hidden by the supplier" })).toBe(t.errItemHidden);
    expect(isItemNameTaken({ message: "item is hidden by the supplier" })).toBe(false);
    expect(describeError({ message: "item is used by requests" })).toBe(t.errItemInUse);
    expect(describeError({ message: "wrong join code" })).toBe(t.errWrongJoinCode);
    expect(describeError({ message: "daily limit of new items reached" })).toBe(t.errDailyItemLimit);
    expect(describeError({ code: "23514", message: 'new row for relation "items" violates check constraint "items_name_length"' }))
      .toBe(t.errTooLong);
  });
});
