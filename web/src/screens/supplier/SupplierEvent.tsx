// An event as a supplier opens it. An open event is worked on from the
// supplier home screen, filtered to it. A closed or cancelled event shows
// read-only: this supplier's requests in it, by company and item category,
// with their final status and the company's comments.
import { useParams } from "react-router-dom";
import { CategorizedList } from "../../components/CategorizedList";
import { Layout } from "../../components/Layout";
import { RequestRow } from "../../components/RequestRow";
import { useEvent } from "../../hooks/useEvent";
import { exportEvent } from "../../lib/exportExcel";
import { itemCache, useCached, useLiveRows, useUnits } from "../../lib/live";
import { useProfile } from "../../lib/session";
import { formatNeededBy } from "../../lib/time";
import type { LogisticsEvent, Request } from "../../lib/types";
import { useActiveSupplier } from "../../lib/activeSupplier";
import { CompanyComments } from "./CompanyComments";
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
  const supplierId = useActiveSupplier();
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
      {companies.map((c) => {
        const companyRows = rows.filter((r) => r.company_id === c).sort((a, b) => a.created_at.localeCompare(b.created_at));
        return (
          <section key={c} className="section">
            <h2 className="section-title">{companyName(c)}</h2>
            <CompanyComments listId={companyRows[0].list_id} eventId={event.id} companyId={c} supplierId={supplierId}
              units={units} editable={false} />
            <CategorizedList rows={companyRows} categoryOf={(r) => itemOf(r.item_id)?.category}
              renderRow={(r) => <RequestRow key={r.id} request={r} item={itemOf(r.item_id)} editable={false} />} />
          </section>
        );
      })}
    </Layout>
  );
}
