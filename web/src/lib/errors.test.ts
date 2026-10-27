import { describe, expect, it } from "vitest";
import { describeError } from "./errors";
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
});
