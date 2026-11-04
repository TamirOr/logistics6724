// The row menu: partial (asks how much), missing, back to pending, note,
// and the item's category, so a new item can be sorted while working. Below,
// the comments on the request and who set its status.
import { useState } from "react";
import { CategoryInput } from "../../components/CategoryInput";
import { RequestComments } from "../../components/RequestComments";
import { RequestQuantity } from "../../components/RequestQuantity";
import { Sheet } from "../../components/Sheet";
import { StatusPicker } from "../../components/StatusPicker";
import { StatusSetBy } from "../../components/StatusSetBy";
import { useAction } from "../../components/Toast";
import { updateItem } from "../../lib/api";
import { itemCache } from "../../lib/live";
import { setStatus, setSupplierNote } from "../../lib/requests";
import type { Item, Request, RequestStatus } from "../../lib/types";
import { t } from "../../strings";

interface Props {
  request: Request;
  item?: Item;
  onClose: () => void;
  /** Called after a status change, so the screen can offer undo. */
  onStatusChanged: (before: Request) => void;
}

const SUPPLIER_STATUSES: RequestStatus[] = ["partial", "missing", "pending"];

export function SupplierRequestSheet({ request: r, item, onClose, onStatusChanged }: Props) {
  const [note, setLocalNote] = useState(r.supplier_note ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const runAction = useAction();

  // The category belongs to the item, so it changes for every request of it.
  const saveCategory = () => {
    if (!item || category.trim() === (item.category ?? "")) return;
    runAction(async () => itemCache.put([await updateItem(item.id, { category: category.trim() || null })]));
  };
  const change = (status: RequestStatus, suppliedQuantity: number | null) => {
    setStatus(r, status, suppliedQuantity);
    if (note !== (r.supplier_note ?? "")) setSupplierNote(r, note);
    saveCategory();
    onStatusChanged(r);
    onClose();
  };
  const save = () => {
    setSupplierNote(r, note);
    saveCategory();
    onClose();
  };

  return (
    <Sheet title={<><RequestQuantity quantity={r.quantity} measure={r.measure} /> <span dir="auto">{item?.name}</span></>} onClose={onClose}>
      <div className="stack">
        {/* Ready is the row's one tap. */}
        <StatusPicker request={r} statuses={SUPPLIER_STATUSES} onPick={change} />
        <label className="field"><span>{t.note}</span>
          <textarea className="input" dir="auto" rows={2} placeholder={t.notePlaceholder} value={note}
            onChange={(e) => setLocalNote(e.target.value)} />
        </label>
        {item && (
          <label className="field"><span>{t.category}</span>
            <CategoryInput supplierId={r.supplier_id} value={category} onChange={setCategory} />
          </label>
        )}
        <button className="btn btn-secondary btn-block" onClick={save}>{t.save}</button>
        <RequestComments request={r} side="supplier" />
        <StatusSetBy request={r} />
      </div>
    </Sheet>
  );
}
