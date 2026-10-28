// System health and pending sign-ups on top, then open events and the
// battalion event button.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { EventCard } from "../../components/EventCard";
import { Layout } from "../../components/Layout";
import { Sheet } from "../../components/Sheet";
import { useAction } from "../../components/Toast";
import { useOpenEvents } from "../../hooks/useOpenEvents";
import { approveUser, rejectUser } from "../../lib/api";
import { useUnits } from "../../lib/live";
import type { Profile } from "../../lib/types";
import { PushPrompt } from "../shared/PushPrompt";
import { HealthStrip } from "./HealthStrip";
import { useUsers } from "./useUsers";
import { unitNamesOf } from "./users";
import { t } from "../../strings";

export function AdminHome() {
  const navigate = useNavigate();
  const runAction = useAction();
  const units = useUnits();
  const { users, reload } = useUsers();
  const { events } = useOpenEvents("");
  const [rejecting, setRejecting] = useState<Profile | null>(null);
  const [reason, setReason] = useState("");

  const pending = (users ?? []).filter((u) => u.approval === "pending");

  const act = (action: () => Promise<void>) => runAction(action, reload);

  return (
    <Layout
      title={t.appName}
      nav={[{ to: "/users", label: t.users }, { to: "/units", label: t.units }, { to: "/history", label: t.history }]}
      bottom={<button className="btn btn-primary btn-big" onClick={() => navigate("/events/new")}>{t.scopeBattalion}</button>}
    >
      <HealthStrip />
      <PushPrompt />
      <h2 className="section-title">{t.pendingSignups}</h2>
      {pending.length === 0 && <p className="muted">{t.noPendingSignups}</p>}
      {pending.map((u) => (
        <article key={u.id} className="card signup">
          <div className="signup-name" dir="auto">{u.first_name} {u.last_name}</div>
          <dl className="signup-fields">
            <dt>{t.serviceNumber}</dt><dd><bdi dir="ltr">{u.service_number}</bdi></dd>
            <dt>{t.emailLabel}</dt><dd><bdi dir="ltr">{u.email}</bdi></dd>
            <dt>{t.side}</dt><dd>{t.roleLabels[u.role]}</dd>
            <dt>{t.unit}</dt><dd>{unitNamesOf(u, units)}</dd>
          </dl>
          <div className="row">
            <button className="btn btn-success" onClick={() => act(() => approveUser(u.id))}>{t.approve}</button>
            <button className="btn btn-danger" onClick={() => { setRejecting(u); setReason(""); }}>{t.reject}</button>
          </div>
        </article>
      ))}

      <h2 className="section-title">{t.openEvents}</h2>
      {events?.length === 0 && <p className="muted">{t.noOpenEvents}</p>}
      {events?.map((e) => <EventCard key={e.id} event={e} />)}

      {rejecting && (
        <Sheet title={`${t.reject}: ${rejecting.first_name} ${rejecting.last_name}`} onClose={() => setRejecting(null)}>
          <div className="stack">
            <input className="input" dir="auto" placeholder={t.rejectReason} value={reason}
              onChange={(e) => setReason(e.target.value)} />
            <button className="btn btn-danger btn-block"
              onClick={() => { act(() => rejectUser(rejecting.id, reason)); setRejecting(null); }}>{t.reject}</button>
          </div>
        </Sheet>
      )}
    </Layout>
  );
}
