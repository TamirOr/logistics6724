// Edit, note, mark, delete or unmark one request.
import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { QuantityInput } from "../../components/QuantityInput";
import { RequestQuantity } from "../../components/RequestQuantity";
import { StatusBadge } from "../../components/StatusBadge";
import { StatusPicker } from "../../components/StatusPicker";
import { useToast } from "../../components/Toast";
import {
  deleteRequest, isClosed, markStatus, restoreRequest, setCustomerNote, setQuantity, setUrgent,
} from "../../lib/requests";
import type { Item, Request, RequestStatus } from "../../lib/types";
import { t } from "../../strings";

const CUSTOMER_STATUSES: RequestStatus[] = ["ready", "partial", "missing", "pending", "collected"];

export function RequestSheet({ request: r, item, onClose }: { request: Request; item?: Item; onClose: () => void }) {
  const [quantity, setLocalQuantity] = useState(r.quantity);
  const [note, setLocalNote] = useState(r.customer_note ?? "");
  const showToast = useToast();

  const save = () => {
    setQuantity(r, quantity);
    setCustomerNote(r, note);
    onClose();
  };
  // A status saves the note with it, not a changed quantity: that would
  // send the request back to pending.
  const mark = (status: RequestStatus, suppliedQuantity: number | null) => {
    setCustomerNote(r, note);
    markStatus(r, status, suppliedQuantity);
    showToast({
      message: t.statusChanged,
      onAction: () => (status === "collected"
        ? restoreRequest({ ...r, status, previous_status: r.status })
        : markStatus(r, r.status, r.supplied_quantity)),
    });
    onClose();
  };
  const remove = () => {
    const undo = deleteRequest(r);
    showToast({ message: t.deleted, onAction: undo });
    onClose();
  };

  return (
    <Sheet title={<><RequestQuantity quantity={r.quantity} measure={r.measure} /> <span dir="auto">{item?.name}</span></>} onClose={onClose}>
      <div className="stack">
        <StatusBadge status={r.status} />
        {isClosed(r) ? (
          <button className="btn btn-secondary btn-block" onClick={() => { restoreRequest(r); onClose(); }}>
            {r.status === "collected" ? t.unmark : t.undo}
          </button>
        ) : (
          <>
            <div className="field"><span>{t.changeStatus}</span>
              <StatusPicker request={r} statuses={CUSTOMER_STATUSES} onPick={mark} />
            </div>
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
