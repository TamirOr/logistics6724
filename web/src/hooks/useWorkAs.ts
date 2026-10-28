// Admins: work as the customer or supplier of a unit, or (null) return to
// admin, then start from that view's home screen.
import { useNavigate } from "react-router-dom";
import { useAction } from "../components/Toast";
import { useQueue } from "../lib/queue";
import { useSession } from "../lib/session";
import { t } from "../strings";

export function useWorkAs() {
  const { switchWorkingUnit } = useSession();
  const queue = useQueue();
  const runAction = useAction();
  const navigate = useNavigate();

  // Switching drops changes not yet sent to the server, so only then ask.
  return (unitId: string | null) => {
    if (queue.length && !window.confirm(t.switchUnsynced(queue.length))) return;
    runAction(() => switchWorkingUnit(unitId), () => navigate("/", { replace: true }));
  };
}
