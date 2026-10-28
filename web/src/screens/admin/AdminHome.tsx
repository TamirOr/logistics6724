// System health and pending sign-ups on top, then open events and the
// battalion event button.
import { useNavigate } from "react-router-dom";
import { EventCard } from "../../components/EventCard";
import { Layout } from "../../components/Layout";
import { PendingSignups } from "../../components/PendingSignups";
import { useAction } from "../../components/Toast";
import { useOpenEvents } from "../../hooks/useOpenEvents";
import { useUsers } from "../../hooks/useUsers";
import { useUnits } from "../../lib/live";
import { awaitsApprovalFrom } from "../../lib/userUnits";
import { PushPrompt } from "../shared/PushPrompt";
import { HealthStrip } from "./HealthStrip";
import { t } from "../../strings";

export function AdminHome() {
  const navigate = useNavigate();
  const runAction = useAction();
  const units = useUnits();
  const { users, reload } = useUsers();
  const { events } = useOpenEvents("");

  const pending = (users ?? []).filter((u) => awaitsApprovalFrom(u, null));

  const act = (action: () => Promise<void>) => runAction(action, reload);

  return (
    <Layout
      title={t.appName}
      nav={[{ to: "/users", label: t.users }, { to: "/units", label: t.units }, { to: "/history", label: t.history }]}
      bottom={<button className="btn btn-primary btn-big" onClick={() => navigate("/events/new")}>{t.scopeBattalion}</button>}
    >
      <HealthStrip />
      <PushPrompt />
      <PendingSignups pending={pending} units={units} act={act} />

      <h2 className="section-title">{t.openEvents}</h2>
      {events?.length === 0 && <p className="muted">{t.noOpenEvents}</p>}
      {events?.map((e) => <EventCard key={e.id} event={e} />)}
    </Layout>
  );
}
