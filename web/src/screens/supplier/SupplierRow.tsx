// One request in the supplier's by-company view. One tap marks it ready.
// Memoized: a change re-renders only the rows it touched, so the handlers
// take the request and stay the same between renders.
import { memo } from "react";
import { RequestNotes } from "../../components/RequestNotes";
import { RequestQuantity } from "../../components/RequestQuantity";
import { StatusBadge } from "../../components/StatusBadge";
import type { Item, MergeSuggestion, Request } from "../../lib/types";
import { t } from "../../strings";

interface Props {
  request: Request;
  item: Item | undefined;
  suggestion: MergeSuggestion | undefined;
  onTap: (r: Request) => void;
  onMenu: (r: Request) => void;
  onAcknowledge: (r: Request) => void;
  onMerge: (s: MergeSuggestion) => void;
  onVerify: (itemId: string) => void;
}

export const SupplierRow = memo(function SupplierRow(
  { request: r, item, suggestion, onTap, onMenu, onAcknowledge, onMerge, onVerify }: Props,
) {
  const cancelled = r.status === "cancelled";
  return (
    <li className={`req req-${r.status} ${r.urgent ? "req-urgent" : ""}`}>
      <button className="req-main" onClick={cancelled ? undefined : () => onTap(r)}>
        <RequestQuantity quantity={r.quantity} measure={r.measure} />
        <span className="req-name user-text" dir="auto">{item?.name ?? "…"}</span>
        {r.urgent && <span className="tag tag-danger urgent-tag">{t.urgent}</span>}
        <StatusBadge status={r.status} />
      </button>
      {cancelled ? (
        <button className="btn btn-secondary btn-small" onClick={() => onAcknowledge(r)}>{t.acknowledgeCancel}</button>
      ) : (
        <button className="icon-btn" aria-label={t.edit} onClick={() => onMenu(r)}>⋯</button>
      )}
      {r.changed_after_handling && <div className="req-sub tag tag-warning">{t.changedAfterHandling}</div>}
      {r.status === "partial" && r.supplied_quantity != null && (
        <div className="req-sub">{t.suppliedOf(r.supplied_quantity, r.quantity)}</div>
      )}
      <RequestNotes request={r} />
      {item && !item.verified && (
        <div className="req-sub merge-hint">
          <span className="tag tag-new">{t.newTag}</span>
          {suggestion && (
            <button className="btn btn-chip" onClick={() => onMerge(suggestion)}>
              <span dir="auto">{t.mergeInto(suggestion.suggested_name)}</span>
            </button>
          )}
          <button className="btn btn-ghost btn-small" onClick={() => onVerify(r.item_id)}>{t.keepAsNew}</button>
        </div>
      )}
    </li>
  );
});
