import { useOnline } from "../hooks/useOnline";
import { useQueue } from "../lib/queue";
import { t } from "../strings";

export function SyncIndicator() {
  const queue = useQueue();
  const online = useOnline();

  // Writes still inside their undo delay are not "unsynced" yet.
  const unsynced = queue.filter((e) => e.tries > 0 || !online).length;
  if (online && !unsynced) return null;
  return (
    <div className={`sync ${online ? "" : "sync-offline"}`} role="status">
      {!online && <span>{t.offline}</span>}
      {unsynced > 0 && <span>{t.unsynced(unsynced)}</span>}
    </div>
  );
}
