// The status buttons of a request sheet, on both sides. Partial first asks
// how much is ready. The current status is not offered, except partial,
// whose quantity can change.
import { useState } from "react";
import type { Request, RequestStatus } from "../lib/types";
import { QuantityInput } from "./QuantityInput";
import { t } from "../strings";

const BUTTON_CLASS: Record<string, string> = {
  ready: "btn-success", partial: "btn-warning", missing: "btn-danger", pending: "btn-secondary", collected: "btn-success",
};

/** The statuses to offer for a request, in the given order. Partial needs a quantity over 1. */
export function offeredStatuses(r: Request, statuses: RequestStatus[]): RequestStatus[] {
  return statuses.filter((s) => (s === "partial" ? r.quantity > 1 : s !== r.status));
}

interface Props {
  request: Request;
  statuses: RequestStatus[];
  onPick: (status: RequestStatus, suppliedQuantity: number | null) => void;
}

export function StatusPicker({ request: r, statuses, onPick }: Props) {
  const [askPartial, setAskPartial] = useState(false);
  const [supplied, setSupplied] = useState(r.supplied_quantity ?? Math.max(1, Math.floor(r.quantity / 2)));

  if (askPartial) {
    return (
      <>
        <label className="field"><span>{t.suppliedQuantity}</span>
          <QuantityInput value={supplied} onChange={(v) => setSupplied(Math.min(v, r.quantity - 1))} />
        </label>
        <button className="btn btn-primary btn-block" disabled={supplied < 1 || supplied >= r.quantity}
          onClick={() => onPick("partial", supplied)}>{t.save}</button>
      </>
    );
  }
  return (
    <div className="button-grid">
      {offeredStatuses(r, statuses).map((s) => (
        <button key={s} className={`btn ${BUTTON_CLASS[s]}`}
          onClick={() => (s === "partial" ? setAskPartial(true) : onPick(s, null))}>
          {t.markStatus[s]}
        </button>
      ))}
    </div>
  );
}
