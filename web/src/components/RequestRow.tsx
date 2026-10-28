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
  onOpen?: () => void;
}

export function RequestRow({ request: r, item, editable, onOpen }: Props) {
  return (
    <li className={`req req-${r.status} ${r.urgent ? "req-urgent" : ""}`}>
      <button className="req-main" onClick={onOpen} disabled={!editable}>
        <RequestQuantity quantity={r.quantity} measure={r.measure} />
        <span className="req-name user-text" dir="auto">{item?.name ?? "…"}</span>
        <StatusBadge status={r.status} />
      </button>
      {editable && !isClosed(r) && (
        <button className={`icon-btn urgent-toggle ${r.urgent ? "on" : ""}`} aria-pressed={r.urgent}
          aria-label={t.urgent} onClick={() => setUrgent(r, !r.urgent)}>!</button>
      )}
      {r.status === "partial" && r.supplied_quantity != null && (
        <div className="req-sub">{t.suppliedOf(r.supplied_quantity, r.quantity)}</div>
      )}
      <RequestNotes request={r} />
    </li>
  );
}
