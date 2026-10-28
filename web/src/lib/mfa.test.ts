import { describe, expect, it } from "vitest";
import type { Factor } from "@supabase/supabase-js";
import { needsSecondFactor, qrImageSrc, verifiedTotp } from "./mfa";

const factor = (overrides: Partial<Factor>): Factor => ({
  id: "f", factor_type: "totp", status: "verified", created_at: "", updated_at: "", ...overrides,
});

describe("admin second factor", () => {
  it("is needed by an admin without aal2 only", () => {
    expect(needsSecondFactor("admin", "aal1")).toBe(true);
    expect(needsSecondFactor("admin", null)).toBe(true);
    expect(needsSecondFactor("admin", "aal2")).toBe(false);
    expect(needsSecondFactor("customer", "aal1")).toBe(false);
    expect(needsSecondFactor("supplier", null)).toBe(false);
  });

  it("verifies with an app already set up, and enrols otherwise", () => {
    expect(verifiedTotp([factor({ id: "a", status: "unverified" }), factor({ id: "b" })])?.id).toBe("b");
    expect(verifiedTotp([factor({ status: "unverified" })])).toBeNull();
    expect(verifiedTotp([factor({ factor_type: "phone" })])).toBeNull();
    expect(verifiedTotp([])).toBeNull();
  });

  it("shows the QR code as an image in either format Supabase sends", () => {
    const encoded = "data:image/svg+xml;charset=utf-8,%3Csvg%20fill%3D%22%23000%22%2F%3E";
    expect(qrImageSrc('data:image/svg+xml;utf-8,<svg fill="#000"/>')).toBe(encoded);
    expect(qrImageSrc('<svg fill="#000"/>')).toBe(encoded);
    expect(qrImageSrc("data:image/png;base64,iVBOR")).toBe("data:image/png;base64,iVBOR");
  });
});
