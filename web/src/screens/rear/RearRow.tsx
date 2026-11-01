// One request on the rear's screen. One tap marks it collected; the menu
// opens its sheet. A cancelled request only shows.
import { RequestNotes } from "../../components/RequestNotes";
import { RequestQuantity } from "../../components/RequestQuantity";
import { StatusBadge } from "../../components/StatusBadge";
import type { Item, Request } from "../../lib/types";
import { t } from "../../strings";

interface Props {
  request: Request;
  item: Item | undefined;
  commentCount: number;
  onTap: () => void;
  onMenu: () => void;
}

export function RearRow({ request: r, item, commentCount, onTap, onMenu }: Props) {
  const cancelled = r.status === "cancelled";
  return (
    <li className={`req req-${r.status} ${r.urgent ? "req-urgent" : ""}`}>
      <button className="req-main" onClick={cancelled ? undefined : onTap}>
        <RequestQuantity quantity={r.quantity} measure={r.measure} />
        <span className="req-name user-text" dir="auto">{item?.name ?? "…"}</span>
        {r.urgent && <span className="tag tag-danger urgent-tag">{t.urgent}</span>}
        <StatusBadge status={r.status} />
      </button>
      <button className="icon-btn" aria-label={t.edit} onClick={onMenu}>⋯</button>
      {r.status === "partial" && r.supplied_quantity != null && (
        <div className="req-sub">{t.suppliedOf(r.supplied_quantity, r.quantity)}</div>
      )}
      <RequestNotes request={r} commentCount={commentCount} />
    </li>
  );
}
