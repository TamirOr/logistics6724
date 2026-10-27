// An event as a supplier opens it. An open event is worked on from the
// supplier home screen, filtered to it. A closed or cancelled event shows
// read-only: this supplier's requests in it, by company, with their final
// status.
import { useParams } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { RequestRow } from "../../components/RequestRow";
import { useEvent } from "../../hooks/useEvent";
import { exportEvent } from "../../lib/exportExcel";
import { itemCache, useCached, useLiveRows, useUnits } from "../../lib/live";
import { useProfile } from "../../lib/session";
import { formatNeededBy } from "../../lib/time";
import type { LogisticsEvent, Request } from "../../lib/types";
import { SupplierHome } from "./SupplierHome";
import { t } from "../../strings";

export function SupplierEvent() {
  const { id } = useParams();
  const { event } = useEvent(id);
  if (event === undefined) return <Layout title={t.loading} back>{null}</Layout>;
  if (event === null) return <Layout title={t.genericError} back>{null}</Layout>;
  if (event.status === "open") return <SupplierHome />;
  return <PastEvent event={event} />;
}

function PastEvent({ event }: { event: LogisticsEvent }) {
  const profile = useProfile();
  const units = useUnits();
  // Row-level security limits this to the supplier's own requests.
  const { rows, loading } = useLiveRows<Request>("requests", {
    column: "event_id", value: event.id, cacheKey: `requests:event:${event.id}:${profile.unit_id}`,
  });
  const itemOf = useCached(itemCache, rows.map((r) => r.item_id));

  const companyName = (companyId: string) => units.find((u) => u.id === companyId)?.name ?? "";
  const companies = [...new Set(rows.map((r) => r.company_id))]
    .sort((a, b) => companyName(a).localeCompare(companyName(b), "he"));

  return (
    <Layout title={event.name} back
      actions={<button className="btn btn-ghost btn-small" onClick={() => exportEvent(event.id, event.name)}>{t.exportExcel}</button>}>
      {formatNeededBy(event) && <p className="muted">{t.neededBy} {formatNeededBy(event)}</p>}
      <p className="notice">{event.status === "cancelled" ? t.eventCancelled : t.readOnly}</p>
      {!loading && rows.length === 0 && <p className="muted empty">{t.emptySection}</p>}
      {companies.map((c) => (
        <section key={c} className="section">
          <h2 className="section-title">{companyName(c)}</h2>
          <ul className="req-list">
            {rows.filter((r) => r.company_id === c).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((r) => (
              <RequestRow key={r.id} request={r} item={itemOf(r.item_id)} editable={false} />
            ))}
          </ul>
        </section>
      ))}
    </Layout>
  );
}
