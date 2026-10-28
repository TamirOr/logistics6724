// The admin's second factor. is_admin() in the database requires aal2,
// which Supabase sets once the session has verified a TOTP code, so an
// admin signed in with the email code alone must verify one first.
import type { Factor } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { UserRole } from "./types";

export type Aal = "aal1" | "aal2" | null;

/** Admin rights need aal2; customers and suppliers need nothing more. */
export const needsSecondFactor = (role: UserRole, aal: Aal) => role === "admin" && aal !== "aal2";

const isVerifiedTotp = (f: Factor) => f.factor_type === "totp" && f.status === "verified";

/** An authenticator app set up already, or null when the admin must enrol one. */
export const verifiedTotp = (factors: Factor[]) => factors.find(isVerifiedTotp) ?? null;

/**
 * The QR code as an image source. Supabase sends SVG markup, which the
 * client prefixes with "data:image/svg+xml;utf-8," without encoding it; a
 * "#" in the markup then ends the URL and the image does not load.
 */
export function qrImageSrc(qrCode: string): string {
  const markup = qrCode.startsWith("data:") ? qrCode.slice(qrCode.indexOf(",") + 1) : qrCode;
  if (!markup.trimStart().startsWith("<")) return qrCode;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** Read from the session in memory, so it works offline. */
export async function currentAal(): Promise<Aal> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel ?? null;
}

export type SecondFactorStart =
  | { step: "verify"; factorId: string }
  | { step: "enroll"; factorId: string; qrSrc: string; secret: string };

/**
 * What the admin does next: type a code from the app they set up, or set
 * one up. Enrolments abandoned half way are removed first, so they do not
 * pile up against the factor limit.
 */
export async function startSecondFactor(): Promise<SecondFactorStart> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const verified = verifiedTotp(data.all);
  if (verified) return { step: "verify", factorId: verified.id };

  for (const f of data.all.filter((f) => f.factor_type === "totp")) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (enrolled.error) throw enrolled.error;
  if (enrolled.data.type !== "totp") throw new Error("unexpected factor type");
  const { id, totp } = enrolled.data;
  return { step: "enroll", factorId: id, qrSrc: qrImageSrc(totp.qr_code), secret: totp.secret };
}

/** Verifying the first code also completes enrolment. */
export async function verifySecondFactor(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}
