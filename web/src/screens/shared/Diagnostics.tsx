// What support needs to know about this phone, with a copy button that
// produces one text block for WhatsApp, a test notification, and a way out
// of a bad local state.
import { useEffect, useState } from "react";
import { formatDateTime } from "../../../../supabase/functions/_shared/excel.ts";
import { Layout } from "../../components/Layout";
import { useAction, useToast } from "../../components/Toast";
import { useOnline } from "../../hooks/useOnline";
import { fetchPushSubscriptionId, sendTestNotification } from "../../lib/api";
import { useUpdateWaiting, workerVersion } from "../../lib/appUpdate";
import { clearAllCaches } from "../../lib/cache";
import { type DiagnosticsInfo, diagnosticsText, readLastSync, readRejected, shortId } from "../../lib/diagnostics";
import { useUnits } from "../../lib/live";
import { currentSubscription, isStandalone, pushSupported } from "../../lib/push";
import { clearQueue, useQueue } from "../../lib/queue";
import { useSession } from "../../lib/session";
import { APP_VERSION } from "../../lib/version";
import { t } from "../../strings";

interface DeviceState { workerVersion: string | null; pushSubscribed: boolean; pushSubscriptionId: string | null }

function useDeviceState(): DeviceState {
  const [state, setState] = useState<DeviceState>({ workerVersion: null, pushSubscribed: false, pushSubscriptionId: null });
  useEffect(() => {
    (async () => {
      const subscription = await currentSubscription().catch(() => null);
      const id = subscription ? await fetchPushSubscriptionId(subscription.endpoint).catch(() => null) : null;
      setState({ workerVersion: await workerVersion(), pushSubscribed: !!subscription, pushSubscriptionId: id });
    })();
  }, []);
  return state;
}

async function clearLocalAndReload(unsent: number) {
  clearAllCaches();
  if ("caches" in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  // Unsent writes are the user's work: keep them unless they say otherwise.
  if (unsent && window.confirm(t.confirmDropQueue(unsent))) clearQueue();
  location.reload();
}

export function Diagnostics() {
  const { session, profile } = useSession();
  const units = useUnits();
  const queue = useQueue();
  const online = useOnline();
  const updateWaiting = useUpdateWaiting();
  const device = useDeviceState();
  const show = useToast();
  const runAction = useAction();

  const oldest = queue[0];
  const info: DiagnosticsInfo = {
    appVersion: APP_VERSION,
    workerVersion: device.workerVersion,
    updateWaiting,
    userId: session?.user.id ?? null,
    role: profile?.role ?? null,
    unit: units.find((u) => u.id === profile?.unit_id)?.name ?? null,
    approval: profile?.approval ?? null,
    online,
    lastSync: readLastSync(),
    queueLength: queue.length,
    oldestQueuedAt: oldest?.createdAt ?? null,
    oldestQueuedTries: oldest?.tries ?? null,
    pushPermission: pushSupported() ? Notification.permission : "unsupported",
    pushSubscribed: device.pushSubscribed,
    pushSubscriptionId: device.pushSubscriptionId,
    standalone: isStandalone(),
    userAgent: navigator.userAgent,
    rejected: readRejected(),
  };

  const copy = () => navigator.clipboard.writeText(diagnosticsText(info))
    .then(() => show({ message: t.copied }))
    .catch(() => show({ message: t.genericError }));
  const yesNo = (value: boolean) => (value ? t.yes : t.no);
  const when = (ms: number | null) => (ms ? formatDateTime(new Date(ms).toISOString()) : t.never);

  return (
    <Layout title={t.diagnostics} back>
      <p className="muted">{t.diagnosticsHint}</p>
      <dl className="facts">
        <dt>{t.appVersion}</dt><dd><bdi dir="ltr">{info.appVersion}</bdi></dd>
        <dt>{t.workerVersion}</dt><dd><bdi dir="ltr">{info.workerVersion ?? "-"}</bdi></dd>
        <dt>{t.updateWaiting}</dt><dd>{yesNo(updateWaiting)}</dd>
        <dt>{t.userId}</dt><dd><bdi dir="ltr">{shortId(info.userId)}</bdi></dd>
        <dt>{t.role}</dt><dd>{info.role ? t.roleLabels[info.role] : "-"}</dd>
        <dt>{t.unit}</dt><dd>{info.unit ?? "-"}</dd>
        <dt>{t.approval}</dt><dd>{info.approval ? t.approvalLabels[info.approval] : "-"}</dd>
        <dt>{t.connection}</dt><dd>{online ? t.online : t.offline}</dd>
        <dt>{t.lastSync}</dt><dd>{when(info.lastSync)}</dd>
        <dt>{t.pendingWrites}</dt>
        <dd>
          {queue.length}
          {oldest?.createdAt && ` · ${t.oldestPending(Math.round((Date.now() - oldest.createdAt) / 1000), oldest.tries)}`}
        </dd>
        <dt>{t.notifications}</dt><dd>{t.permissionLabels[info.pushPermission]}</dd>
        <dt>{t.subscribedHere}</dt><dd>{yesNo(info.pushSubscribed)}</dd>
        <dt>{t.subscriptionId}</dt><dd><bdi dir="ltr">{shortId(info.pushSubscriptionId)}</bdi></dd>
        <dt>{t.mode}</dt><dd>{info.standalone ? t.homeScreen : t.browser}</dd>
        <dt>{t.device}</dt><dd><bdi dir="ltr" className="small">{info.userAgent}</bdi></dd>
      </dl>

      <h2 className="section-title">{t.rejectedWrites}</h2>
      {info.rejected.length === 0 && <p className="muted">{t.none}</p>}
      <ul className="req-list">
        {info.rejected.map((r) => (
          <li key={r.at} className="req">
            <span>{when(r.at)}</span>
            <bdi dir="ltr">{r.kind} {r.target} {r.code}</bdi>
          </li>
        ))}
      </ul>

      <div className="stack">
        <button className="btn btn-primary btn-block" onClick={copy}>{t.copy}</button>
        <button className="btn btn-secondary btn-block"
          onClick={() => runAction(sendTestNotification, () => show({ message: t.testSent }))}>{t.sendTest}</button>
        <button className="btn btn-ghost btn-block" onClick={() => clearLocalAndReload(queue.length)}>{t.clearLocal}</button>
      </div>
    </Layout>
  );
}
