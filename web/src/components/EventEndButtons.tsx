// Close and cancel for an open event. Neither can be undone, so each asks
// first (the spec skips confirmation only for reversible actions).
import { useNavigate } from "react-router-dom";
import { cancelEvent, closeEvent } from "../lib/api";
import type { LogisticsEvent } from "../lib/types";
import { useAction } from "./Toast";
import { t } from "../strings";

interface Props {
  event: LogisticsEvent;
  canClose: boolean;
  canCancel: boolean;
}

export function EventEndButtons({ event, canClose, canCancel }: Props) {
  const navigate = useNavigate();
  const runAction = useAction();
  if (event.status !== "open" || (!canClose && !canCancel)) return null;

  const endWith = (question: string, action: (id: string) => Promise<void>) => {
    if (!window.confirm(question)) return;
    runAction(() => action(event.id), () => navigate("/"));
  };

  return (
    <div className="danger-zone">
      {canClose && (
        <button className="btn btn-secondary" onClick={() => endWith(t.confirmClose(event.name), closeEvent)}>
          {t.closeEvent}
        </button>
      )}
      {canCancel && (
        <button className="btn btn-danger"
          onClick={() => endWith(event.scope === "battalion" ? t.confirmCancelBattalion(event.name) : t.confirmCancel(event.name), cancelEvent)}>
          {t.cancelEvent}
        </button>
      )}
    </div>
  );
}
