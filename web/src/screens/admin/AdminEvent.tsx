// An event as the admin sees it: each company's list status, with close
// and cancel.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { EventEndButtons } from "../../components/EventEndButtons";
import { Layout } from "../../components/Layout";
import { ListStatusBadge, StatusCounts } from "../../components/StatusBadge";
import { useEvent } from "../../hooks/useEvent";
import { fetchListOverviews } from "../../lib/api";
import { exportEvent } from "../../lib/exportExcel";
import { formatNeededBy } from "../../lib/time";
import type { ListOverview } from "../../lib/types";
import { t } from "../../strings";

export function AdminEvent() {
  const { id } = useParams();
  const { event } = useEvent(id);
  const [lists, setLists] = useState<ListOverview[]>([]);

  useEffect(() => {
    if (id) fetchListOverviews([id]).then(setLists);
  }, [id, event?.status]);

  if (!event) return <Layout title={t.loading} back>{null}</Layout>;


  return (
    <Layout title={event.name} back
      actions={<button className="btn btn-ghost btn-small" onClick={() => exportEvent(event.id, event.name)}>{t.exportExcel}</button>}>
      {formatNeededBy(event) && <p className="muted">{t.neededBy} {formatNeededBy(event)}</p>}
      <ul className="req-list">
        {lists.sort((a, b) => a.company_name.localeCompare(b.company_name, "he")).map((l) => (
          <li key={l.id} className="req">
            <div className="req-main">
              <span className="req-name">{l.company_name}</span>
              <ListStatusBadge status={l.status} />
              <StatusCounts list={l} />
            </div>
          </li>
        ))}
      </ul>
      <EventEndButtons event={event} canClose canCancel />
    </Layout>
  );
}
