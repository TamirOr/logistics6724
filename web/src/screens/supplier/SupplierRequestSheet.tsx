// The row menu: partial (asks how much), missing, back to pending, note.
import { useState } from "react";
import { QuantityInput } from "../../components/QuantityInput";
import { RequestQuantity } from "../../components/RequestQuantity";
import { Sheet } from "../../components/Sheet";
import { setStatus, setSupplierNote } from "../../lib/requests";
import type { Item, Request } from "../../lib/types";
import { t } from "../../strings";

interface Props {
  request: Request;
  item?: Item;
  onClose: () => void;
  /** Called after a status change, so the screen can offer undo. */
  onStatusChanged: (before: Request) => void;
}

export function SupplierRequestSheet({ request: r, item, onClose, onStatusChanged }: Props) {
  const [askPartial, setAskPartial] = useState(false);
  const [supplied, setSupplied] = useState(r.supplied_quantity ?? Math.max(1, Math.floor(r.quantity / 2)));
  const [note, setLocalNote] = useState(r.supplier_note ?? "");

  const change = (status: Request["status"], suppliedQuantity: number | null = null) => {
    setStatus(r, status, suppliedQuantity);
    if (note !== (r.supplier_note ?? "")) setSupplierNote(r, note);
    onStatusChanged(r);
    onClose();
  };
  const saveNote = () => {
    setSupplierNote(r, note);
    onClose();
  };

  return (
    <Sheet title={<><RequestQuantity quantity={r.quantity} measure={r.measure} /> <span dir="auto">{item?.name}</span></>} onClose={onClose}>
      <div className="stack">
        {askPartial ? (
          <>
            <label className="field"><span>{t.suppliedQuantity}</span>
              <QuantityInput value={supplied} onChange={(v) => setSupplied(Math.min(v, r.quantity - 1))} />
            </label>
            <button className="btn btn-primary btn-block" disabled={supplied < 1 || supplied >= r.quantity}
              onClick={() => change("partial", supplied)}>{t.save}</button>
          </>
        ) : (
          <div className="button-grid">
            {r.quantity > 1 && (
              <button className="btn btn-warning" onClick={() => setAskPartial(true)}>{t.markPartial}</button>
            )}
            <button className="btn btn-danger" onClick={() => change("missing")}>{t.markMissing}</button>
            {r.status !== "pending" && (
              <button className="btn btn-secondary" onClick={() => change("pending")}>{t.markPending}</button>
            )}
          </div>
        )}
        <label className="field"><span>{t.note}</span>
          <textarea className="input" dir="auto" rows={2} placeholder={t.notePlaceholder} value={note}
            onChange={(e) => setLocalNote(e.target.value)} />
        </label>
        <button className="btn btn-secondary btn-block" onClick={saveNote}>{t.save}</button>
      </div>
    </Sheet>
  );
}
