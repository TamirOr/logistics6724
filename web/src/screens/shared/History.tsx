// Events within the retention period (app_config, 90 days), read-only, each
// with "שכפל". Also the picker behind "שכפל אירוע קודם", and the date-range
// Excel export.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EventCard } from "../../components/EventCard";
import { Layout } from "../../components/Layout";
import { useAction } from "../../components/Toast";
import { fetchEvents, fetchListOverviews, fetchTuning } from "../../lib/api";
import { exportHistory } from "../../lib/exportExcel";
import { useProfile } from "../../lib/session";
import { daysAgo } from "../../lib/time";
import type { ListOverview, LogisticsEvent } from "../../lib/types";
import { t } from "../../strings";

const toDateInput = (iso: string) => iso.slice(0, 10);

export function History({ pick = false }: { pick?: boolean }) {
  const profile = useProfile();
  const navigate = useNavigate();
  const runAction = useAction();
  const [events, setEvents] = useState<LogisticsEvent[] | null>(null);
  const [lists, setLists] = useState<ListOverview[]>([]);
  const [from, setFrom] = useState(toDateInput(daysAgo(30)));
  const [to, setTo] = useState(toDateInput(new Date().toISOString()));

  useEffect(() => {
    fetchTuning("retention_days", "90").then((days) => fetchEvents("history", daysAgo(Number(days)))).then(async (evs) => {
      setEvents(evs);
      if (profile.role === "customer") setLists(await fetchListOverviews(evs.map((e) => e.id)));
    });
  }, [profile.role]);

  const canDuplicate = (e: LogisticsEvent) =>
    profile.role === "customer" || (profile.role === "admin" && e.scope === "battalion");

  const exportRange = async () => {
    const until = new Date(to);
    until.setDate(until.getDate() + 1);
    await runAction(() => exportHistory(new Date(from).toISOString(), until.toISOString(), `${from}–${to}`));
  };

  return (
    <Layout title={pick ? t.pickEventToDuplicate : t.history} back>
      {!pick && (
        <section className="card export-range">
          <label className="field"><span>{t.from}</span>
            <input className="input" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field"><span>{t.to}</span>
            <input className="input" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn-secondary" onClick={exportRange}>{t.exportExcel}</button>
        </section>
      )}
      {events === null && <p className="muted">{t.loading}</p>}
      {events?.length === 0 && <p className="muted">{t.noHistory}</p>}
      {events?.map((e) => (
        <EventCard key={e.id} event={e} list={lists.find((l) => l.event_id === e.id)}>
          {canDuplicate(e) && (
            <button className="btn btn-secondary" onClick={() => navigate(`/events/${e.id}/duplicate`)}>{t.duplicate}</button>
          )}
        </EventCard>
      ))}
    </Layout>
  );
}
