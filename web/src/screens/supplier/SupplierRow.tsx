// One request in the supplier's by-company view. One tap marks it ready.
import { RequestNotes } from "../../components/RequestNotes";
import { RequestQuantity } from "../../components/RequestQuantity";
import { StatusBadge } from "../../components/StatusBadge";
import type { Item, MergeSuggestion, Request } from "../../lib/types";
import { t } from "../../strings";

interface Props {
  request: Request;
  item: Item | undefined;
  suggestion: MergeSuggestion | undefined;
  onTap: () => void;
  onMenu: () => void;
  onAcknowledge: () => void;
  onMerge: (s: MergeSuggestion) => void;
  onVerify: () => void;
}

export function SupplierRow({ request: r, item, suggestion, onTap, onMenu, onAcknowledge, onMerge, onVerify }: Props) {
  const cancelled = r.status === "cancelled";
  return (
    <li className={`req req-${r.status} ${r.urgent ? "req-urgent" : ""}`}>
      <button className="req-main" onClick={cancelled ? undefined : onTap}>
        {r.urgent && <span className="urgent-dot" aria-label={t.urgent} />}
        <RequestQuantity quantity={r.quantity} measure={r.measure} />
        <span className="req-name user-text" dir="auto">{item?.name ?? "…"}</span>
        <StatusBadge status={r.status} />
      </button>
      {cancelled ? (
        <button className="btn btn-secondary btn-small" onClick={onAcknowledge}>{t.acknowledgeCancel}</button>
      ) : (
        <button className="icon-btn" aria-label={t.edit} onClick={onMenu}>⋯</button>
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
          <button className="btn btn-ghost btn-small" onClick={onVerify}>{t.keepAsNew}</button>
        </div>
      )}
    </li>
  );
}
