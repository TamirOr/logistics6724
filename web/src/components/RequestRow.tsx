// One request as the company sees it: quantity and measure, item, status, notes.
// Editable on the customer event screen (tap to edit, urgent toggle);
// read-only in past events.
import type { Item, Request } from "../lib/types";
import { isClosed, setUrgent } from "../lib/requests";
import { RequestNotes } from "./RequestNotes";
import { RequestQuantity } from "./RequestQuantity";
import { StatusBadge } from "./StatusBadge";
import { t } from "../strings";

interface Props {
  request: Request;
  item: Item | undefined;
  editable: boolean;
  commentCount?: number;
  onOpen?: () => void;
}

export function RequestRow({ request: r, item, editable, commentCount, onOpen }: Props) {
  const canFlag = editable && !isClosed(r);
  return (
    <li className={`req req-${r.status} ${r.urgent ? "req-urgent" : ""}`}>
      <button className="req-main" onClick={onOpen} disabled={!editable}>
        <RequestQuantity quantity={r.quantity} measure={r.measure} />
        <span className="req-name user-text" dir="auto">{item?.name ?? "…"}</span>
        {r.urgent && !canFlag && <span className="tag tag-danger urgent-tag">{t.urgent}</span>}
        <StatusBadge status={r.status} />
      </button>
      {/* Where it shows, the toggle is the urgent mark, so the row has one, not two. */}
      {canFlag && (
        <button className={`urgent-toggle ${r.urgent ? "on" : ""}`} aria-pressed={r.urgent}
          onClick={() => setUrgent(r, !r.urgent)}><span>! {t.urgent}</span></button>
      )}
      {r.status === "partial" && r.supplied_quantity != null && (
        <div className="req-sub">{t.suppliedOf(r.supplied_quantity, r.quantity)}</div>
      )}
      <RequestNotes request={r} commentCount={commentCount} />
    </li>
  );
}
