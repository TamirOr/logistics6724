import { afterEach, describe, expect, it } from "vitest";
import { pickActiveSupplier, setActiveSupplier } from "./activeSupplier";
import { readCache } from "./cache";
import { makeProfile } from "../test/fixtures";

afterEach(() => localStorage.clear());

describe("pickActiveSupplier", () => {
  const cook = makeProfile({ role: "supplier", unit_id: "kitchen", supplier_ids: ["kitchen", "closing"] });

  it("keeps the unit the user picked", () => {
    expect(pickActiveSupplier("closing", cook)).toBe("closing");
  });

  it("falls back to the main unit with no choice yet", () => {
    expect(pickActiveSupplier(null, cook)).toBe("kitchen");
  });

  it("falls back to the main unit once the user left the picked one", () => {
    expect(pickActiveSupplier("stores", cook)).toBe("kitchen");
  });

  it("uses the main unit of a profile cached before supplier_ids existed", () => {
    const cached = { ...cook, supplier_ids: undefined } as unknown as typeof cook;
    expect(pickActiveSupplier("closing", cached)).toBe("kitchen");
  });
});

describe("setActiveSupplier", () => {
  it("saves the choice on the device", () => {
    setActiveSupplier("closing");
    expect(readCache("active-supplier")).toBe("closing");
  });
});
