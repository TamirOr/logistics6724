// Hebrew labels shared by the web app and the Edge Functions.
export type RequestStatus = "pending" | "ready" | "partial" | "missing" | "collected" | "cancelled";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "ממתין",
  ready: "מוכן לאיסוף",
  partial: "חלקי",
  missing: "חסר",
  collected: "נאסף",
  cancelled: "בוטל על ידי הלקוח",
};
