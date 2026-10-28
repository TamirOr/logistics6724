// "What is the state of my requests": who is signed in and for which
// company, then open events, newest first, each with its list status and
// counts. Battalion events not filled yet go on top.
import { useNavigate } from "react-router-dom";
import { EventCard } from "../../components/EventCard";
import { Layout } from "../../components/Layout";
import { ProfileCard } from "../../components/ProfileCard";
import { useOpenEvents } from "../../hooks/useOpenEvents";
import { useUnits } from "../../lib/live";
import { useProfile } from "../../lib/session";
import { PushPrompt } from "../shared/PushPrompt";
import { unitUsersNav } from "../shared/unitUsers";
import { t } from "../../strings";

export function CustomerHome() {
  const profile = useProfile();
  const units = useUnits();
  const navigate = useNavigate();
  const { events, lists } = useOpenEvents(`company_id=eq.${profile.unit_id}`);

  const listByEvent = new Map(lists.filter((l) => l.company_id === profile.unit_id).map((l) => [l.event_id, l]));
  const listOf = (eventId: string) => listByEvent.get(eventId);
  // Battalion events this company has not filled yet go on top.
  const unfilledIds = new Set((events ?? [])
    .filter((e) => e.scope === "battalion" && (listOf(e.id)?.n_total ?? 0) === 0).map((e) => e.id));
  const unfilled = (eventId: string) => unfilledIds.has(eventId);
  const sorted = [...(events ?? [])].sort((a, b) =>
    Number(unfilled(b.id)) - Number(unfilled(a.id)) || b.created_at.localeCompare(a.created_at));

  return (
    <Layout
      title={t.openEvents}
      nav={[{ to: "/history", label: t.history }, ...unitUsersNav(profile)]}
      bottom={
        <>
          <button className="btn btn-primary btn-big" onClick={() => navigate("/events/new")}>{t.newEvent}</button>
          <button className="btn btn-secondary btn-big" onClick={() => navigate("/duplicate")}>{t.duplicatePrevious}</button>
        </>
      }
    >
      <PushPrompt />
      <ProfileCard profile={profile} units={units} activeUnitId={profile.unit_id!} />
      {events === null && <p className="muted">{t.loading}</p>}
      {events?.length === 0 && <p className="muted empty">{t.noOpenEvents}</p>}
      {sorted.map((e) => (
        <div key={e.id} className={unfilled(e.id) ? "highlight" : ""}>
          {unfilled(e.id) && <div className="tag tag-warning">{t.notFilledYet}</div>}
          <EventCard event={e} list={listOf(e.id)} />
        </div>
      ))}
    </Layout>
  );
}
