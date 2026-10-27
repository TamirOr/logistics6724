// "New version, tap to reload". The reload waits until every queued write
// has been sent, so nothing is lost and old code never sends to a new schema.
import { useEffect, useState } from "react";
import { applyUpdate, useUpdateWaiting } from "../lib/appUpdate";
import { useQueue } from "../lib/queue";
import { t } from "../strings";

export function UpdateBanner() {
  const waiting = useUpdateWaiting();
  const queue = useQueue();
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (requested && queue.length === 0) applyUpdate();
  }, [requested, queue.length]);

  if (!waiting) return null;
  return (
    <button className="update-banner" onClick={() => setRequested(true)} disabled={requested}>
      {requested && queue.length ? t.updateAfterSync : t.updateAvailable}
    </button>
  );
}
