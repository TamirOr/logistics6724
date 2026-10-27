// "What is the state of my requests": open events, newest first, each with
// its list status and counts. Battalion events not filled yet go on top.
import { useNavigate } from "react-router-dom";
import { EventCard } from "../../components/EventCard";
import { Layout } from "../../components/Layout";
import { useOpenEvents } from "../../hooks/useOpenEvents";
import { useProfile } from "../../lib/session";
import { PushPrompt } from "../shared/PushPrompt";
import { t } from "../../strings";

export function CustomerHome() {
  const profile = useProfile();
  const navigate = useNavigate();
  const { events, lists } = useOpenEvents(`company_id=eq.${profile.unit_id}`);

  const listOf = (eventId: string) => lists.find((l) => l.event_id === eventId && l.company_id === profile.unit_id);
  const unfilled = (eventId: string) => {
    const e = events?.find((x) => x.id === eventId);
    return e?.scope === "battalion" && (listOf(eventId)?.n_total ?? 0) === 0;
  };
  const sorted = [...(events ?? [])].sort((a, b) =>
    Number(unfilled(b.id)) - Number(unfilled(a.id)) || b.created_at.localeCompare(a.created_at));

  return (
    <Layout
      title={t.openEvents}
      nav={[{ to: "/history", label: t.history }]}
      bottom={
        <>
          <button className="btn btn-primary btn-big" onClick={() => navigate("/events/new")}>{t.newEvent}</button>
          <button className="btn btn-secondary btn-big" onClick={() => navigate("/duplicate")}>{t.duplicatePrevious}</button>
        </>
      }
    >
      <PushPrompt />
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
