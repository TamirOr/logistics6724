import { describe, expect, it } from "vitest";
import { makeProfile } from "../test/fixtures";
import { echelonOf, isRear, otherEchelon, screensOf, writerLabel } from "./echelon";

describe("echelons", () => {
  it("a profile cached before echelons is in the front", () => {
    expect(echelonOf(makeProfile({ echelon: undefined }))).toBe("front");
  });

  it("the rear works in the rear's screens, the front in the customer's", () => {
    expect(screensOf(makeProfile({ echelon: "rear" }))).toBe("rear");
    expect(screensOf(makeProfile({ echelon: "front" }))).toBe("customer");
  });

  it("only a company user is in the rear", () => {
    expect(isRear(makeProfile({ role: "supplier", echelon: "rear" }))).toBe(false);
    expect(screensOf(makeProfile({ role: "admin", unit_id: null, echelon: "rear" }))).toBe("admin");
  });

  it("switches to the other echelon", () => {
    expect(otherEchelon(makeProfile({ echelon: "front" }))).toBe("rear");
    expect(otherEchelon(makeProfile({ echelon: "rear" }))).toBe("front");
  });

  it("names the echelon beside the company, and a supplier unit alone", () => {
    expect(writerLabel("פלוגה א", "rear")).toBe("פלוגה א · מפלג אחורי");
    expect(writerLabel("אפסנאות", null)).toBe("אפסנאות");
  });
});
