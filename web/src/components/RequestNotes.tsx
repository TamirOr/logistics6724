// The two notes under a request row: the company's, then the supplier's
// reply in the note color. Both sides see both. Then how many comments the
// request has, which its sheet shows.
import type { Request } from "../lib/types";
import { t } from "../strings";

export function RequestNotes({ request: r, commentCount = 0 }: { request: Request; commentCount?: number }) {
  return (
    <>
      {r.customer_note && <Note className="req-note-customer" label={t.customerNote} text={r.customer_note} />}
      {r.supplier_note && <Note label={t.supplierNote} text={r.supplier_note} />}
      {commentCount > 0 && <div className="req-sub"><span className="tag">{t.commentCount(commentCount)}</span></div>}
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
