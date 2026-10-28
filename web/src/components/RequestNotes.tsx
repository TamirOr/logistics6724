// The two notes under a request row: the company's, then the supplier's
// reply in the note color. Both sides see both.
import type { Request } from "../lib/types";
import { t } from "../strings";

export function RequestNotes({ request: r }: { request: Request }) {
  return (
    <>
      {r.customer_note && <Note className="req-note-customer" label={t.customerNote} text={r.customer_note} />}
      {r.supplier_note && <Note label={t.supplierNote} text={r.supplier_note} />}
    </>
  );
}

function Note({ label, text, className = "" }: { label: string; text: string; className?: string }) {
  return (
    <div className={`req-note ${className}`}>
      <span className="req-note-label">{label}:</span> <span className="user-text" dir="auto">{text}</span>
    </div>
  );
}
