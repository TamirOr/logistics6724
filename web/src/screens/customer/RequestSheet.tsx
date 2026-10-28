// Edit, note, delete or unmark one request.
import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { QuantityInput } from "../../components/QuantityInput";
import { StatusBadge } from "../../components/StatusBadge";
import { useToast } from "../../components/Toast";
import { deleteRequest, isClosed, restoreRequest, setCustomerNote, setQuantity, setUrgent } from "../../lib/requests";
import type { Item, Request } from "../../lib/types";
import { t } from "../../strings";

export function RequestSheet({ request: r, item, onClose }: { request: Request; item?: Item; onClose: () => void }) {
  const [quantity, setLocalQuantity] = useState(r.quantity);
  const [note, setLocalNote] = useState(r.customer_note ?? "");
  const showToast = useToast();

  const save = () => {
    setQuantity(r, quantity);
    setCustomerNote(r, note);
    onClose();
  };
  const remove = () => {
    const undo = deleteRequest(r);
    showToast({ message: t.deleted, onAction: undo });
    onClose();
  };

  return (
    <Sheet title={<><span className="req-qty">{r.quantity}</span> <span dir="auto">{item?.name}</span></>} onClose={onClose}>
      <div className="stack">
        <StatusBadge status={r.status} />
        {isClosed(r) ? (
          <button className="btn btn-secondary btn-block" onClick={() => { restoreRequest(r); onClose(); }}>
            {r.status === "collected" ? t.unmark : t.undo}
          </button>
        ) : (
          <>
            <QuantityInput value={quantity} onChange={setLocalQuantity} />
            <label className="switch">
              <input type="checkbox" checked={r.urgent} onChange={(e) => setUrgent(r, e.target.checked)} />
              <span>{t.urgent}</span>
            </label>
            <label className="field"><span>{t.customerNote}</span>
              <textarea className="input" dir="auto" rows={2} placeholder={t.customerNotePlaceholder} value={note}
                onChange={(e) => setLocalNote(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-block" onClick={save}>{t.save}</button>
            <button className="btn btn-danger btn-block" onClick={remove}>{t.delete}</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
