// One user's page: their profile, then for support calls their devices, the
// notifications that should have reached them, and the changes they made.
// The profile comes from the users list, so it shows even if the support
// call fails.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatDateTime } from "../../../../supabase/functions/_shared/excel.ts";
import { Layout } from "../../components/Layout";
import { fetchUserSupport } from "../../lib/api";
import { useUnits } from "../../lib/live";
import type { UserSupport } from "../../lib/types";
import { UserFields } from "./UserFields";
import { useUsers } from "./useUsers";
import { t } from "../../strings";

const when = (iso: string | null) => (iso ? formatDateTime(iso) : t.never);

export function AdminUserSupport() {
  const { id = "" } = useParams();
  const { users } = useUsers();
  const units = useUnits();
  const [support, setSupport] = useState<UserSupport | null>(null);
  useEffect(() => {
    fetchUserSupport(id).then(setSupport).catch(() => setSupport(null));
  }, [id]);

  const user = users?.find((u) => u.id === id);
  const title = user ? `${user.first_name} ${user.last_name}` : t.support;

  return (
    <Layout title={title} back>
      {user && (
        <>
          <h2 className="section-title">{t.profile}</h2>
          <UserFields user={user} units={units} />
          {!user.active && <p><span className="tag">{t.inactive}</span></p>}
        </>
      )}
      {!support && <p className="muted">{t.loading}</p>}
      {support && (
        <>
          <h2 className="section-title">{t.devices}</h2>
          {support.devices.length === 0 && <p className="muted">{t.noDevices}</p>}
          <ul className="req-list">
            {support.devices.map((d) => (
              <li key={d.id} className="req">
                <div className="req-main">
                  <bdi dir="ltr" className="req-name small">{d.user_agent ?? d.id.slice(0, 8)}</bdi>
                </div>
                <div className="req-sub muted">
                  <span>{t.registered}: {when(d.created_at)}</span>
                  <span>{t.lastDelivered}: {when(d.last_success_at)}</span>
                </div>
              </li>
            ))}
          </ul>

          <h2 className="section-title">{t.recentNotifications}</h2>
          {support.notifications.length === 0 && <p className="muted">{t.noNotifications}</p>}
          <ul className="req-list">
            {support.notifications.map((n) => (
              <li key={n.id} className={`req ${n.sent_at ? "" : "req-missing"}`}>
                <div className="req-main"><span className="req-name" dir="auto">{n.body}</span></div>
                <div className="req-sub muted">
                  <span>{when(n.created_at)}</span>
                  <span>{n.sent_at ? `${t.sentAt} ${when(n.sent_at)}` : t.notSent}</span>
                  <span>{t.attempts(n.attempts)}</span>
                  {n.last_error && <bdi dir="ltr" className="small">{n.last_error}</bdi>}
                </div>
              </li>
            ))}
          </ul>

          <h2 className="section-title">{t.recentChanges}</h2>
          {support.audit.length === 0 && <p className="muted">{t.noChanges}</p>}
          <ul className="req-list">
            {support.audit.map((a, i) => (
              <li key={`${a.at}-${i}`} className="req">
                <div className="req-main">
                  <span>{when(a.at)}</span>
                  <span>{t.auditOps[a.op]}</span>
                  <bdi dir="ltr" className="small">{a.table_name} {a.row_id.slice(0, 8)}</bdi>
                </div>
                <div className="req-sub muted"><bdi dir="ltr" className="small">{JSON.stringify(a.changed)}</bdi></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Layout>
  );
}
