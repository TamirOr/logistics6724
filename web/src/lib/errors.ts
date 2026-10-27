import { t } from "../strings";

/**
 * The generic failure message plus the server's own reason, so a user can
 * report what went wrong. Server reasons are English; they are shown as is.
 */
export function describeError(error: unknown, base: string = t.genericError): string {
  const detail = error instanceof Error || (typeof error === "object" && error !== null && "message" in error)
    ? String((error as { message: unknown }).message ?? "").trim()
    : "";
  return detail ? `${base} (${detail})` : base;
}
