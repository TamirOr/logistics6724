// The rear's sheet for one request: its status (partial asks how much was
// there), unmarking a pickup, the comments on it, and who set the status.
// Quantity, urgency and the company note stay the front's.
import { RequestComments } from "../../components/RequestComments";
import { RequestNotes } from "../../components/RequestNotes";
import { RequestQuantity } from "../../components/RequestQuantity";
import { Sheet } from "../../components/Sheet";
import { StatusBadge } from "../../components/StatusBadge";
import { StatusPicker } from "../../components/StatusPicker";
import { StatusSetBy } from "../../components/StatusSetBy";
import { markStatus, restoreRequest } from "../../lib/requests";
import type { Item, Request, RequestStatus } from "../../lib/types";
import { t } from "../../strings";

interface Props {
  request: Request;
  item?: Item;
  onClose: () => void;
  /** Called after a status change, so the screen can offer undo. */
  onStatusChanged: (before: Request, marked: RequestStatus) => void;
}

const REAR_STATUSES: RequestStatus[] = ["collected", "ready", "partial", "missing", "pending"];

export function RearRequestSheet({ request: r, item, onClose, onStatusChanged }: Props) {
  const mark = (status: RequestStatus, suppliedQuantity: number | null) => {
    markStatus(r, status, suppliedQuantity);
    onStatusChanged(r, status);
    onClose();
  };
  const unmark = () => {
    restoreRequest(r);
    onClose();
  };

  return (
    <Sheet title={<><RequestQuantity quantity={r.quantity} measure={r.measure} /> <span dir="auto">{item?.name}</span></>} onClose={onClose}>
      <div className="stack">
        <StatusBadge status={r.status} />
        {r.status === "collected" && <button className="btn btn-secondary btn-block" onClick={unmark}>{t.unmark}</button>}
        {r.status !== "collected" && r.status !== "cancelled" && (
          <div className="field"><span>{t.changeStatus}</span>
            <StatusPicker request={r} statuses={REAR_STATUSES} onPick={mark} />
          </div>
        )}
        <RequestNotes request={r} />
        <RequestComments request={r} side="customer" />
        <StatusSetBy request={r} />
      </div>
    </Sheet>
  );
}
