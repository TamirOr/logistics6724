// Edit, note, mark, delete or unmark one request, give its item a category
// if it has none, and comment on it.
import { useState } from "react";
import { CategoryInput } from "../../components/CategoryInput";
import { Sheet } from "../../components/Sheet";
import { QuantityInput } from "../../components/QuantityInput";
import { RequestComments } from "../../components/RequestComments";
import { RequestQuantity } from "../../components/RequestQuantity";
import { StatusBadge } from "../../components/StatusBadge";
import { StatusPicker } from "../../components/StatusPicker";
import { StatusSetBy } from "../../components/StatusSetBy";
import { useAction, useToast } from "../../components/Toast";
import { addItemCategory } from "../../lib/api";
import { categoryToAdd } from "../../lib/categories";
import { itemCache } from "../../lib/live";
import {
  deleteRequest, isClosed, markStatus, restoreRequest, setCustomerNote, setQuantity, setUrgent, undoMark,
} from "../../lib/requests";
import type { Item, Request, RequestStatus } from "../../lib/types";
import { t } from "../../strings";

const CUSTOMER_STATUSES: RequestStatus[] = ["ready", "partial", "missing", "pending", "collected"];

export function RequestSheet({ request: r, item, onClose }: { request: Request; item?: Item; onClose: () => void }) {
  const [quantity, setLocalQuantity] = useState(r.quantity);
  const [note, setLocalNote] = useState(r.customer_note ?? "");
  const [category, setCategory] = useState("");
  const showToast = useToast();
  const runAction = useAction();

  // The category belongs to the item, so it sorts every request of it.
  const saveCategory = () => {
    const added = item && categoryToAdd(item.category, category);
    if (!item || !added) return;
    runAction(async () => itemCache.put([{ ...item, category: await addItemCategory(item.id, added) }]));
  };
  const save = () => {
    setQuantity(r, quantity);
    setCustomerNote(r, note);
    saveCategory();
    onClose();
  };
  // A status saves the note and category with it, not a changed quantity:
  // that would send the request back to pending.
  const mark = (status: RequestStatus, suppliedQuantity: number | null) => {
    setCustomerNote(r, note);
    saveCategory();
    markStatus(r, status, suppliedQuantity);
    showToast({ message: t.statusChanged, onAction: () => undoMark(r, status) });
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
            {item && (item.category ? (
              <div className="muted">{t.category}: <span dir="auto" className="user-text">{item.category}</span></div>
            ) : (
              <label className="field"><span>{t.category}</span>
                <CategoryInput supplierId={r.supplier_id} value={category} onChange={setCategory} />
              </label>
            ))}
            <button className="btn btn-primary btn-block" onClick={save}>{t.save}</button>
            <button className="btn btn-danger btn-block" onClick={remove}>{t.delete}</button>
          </>
        )}
        <RequestComments request={r} side="customer" />
        <StatusSetBy request={r} />
      </div>
    </Sheet>
  );
}
