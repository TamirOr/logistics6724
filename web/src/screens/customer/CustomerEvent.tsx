// The company's list in one event: a section per supplier, in alphabetical
// order, each a live checklist grouped by item category, ending with an add
// row and "אספתי". Comments to every supplier sit on top, and each section
// holds the comments between the company and that supplier. Filters by
// category and status narrow every section; a section with nothing left to
// show hides while they are on.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CategorizedList } from "../../components/CategorizedList";
import { CommentThread } from "../../components/CommentThread";
import { ItemAdder } from "../../components/ItemAdder";
import { RequestFilters } from "../../components/RequestFilters";
import { EventEndButtons } from "../../components/EventEndButtons";
import { Layout } from "../../components/Layout";
import { useToast } from "../../components/Toast";
import { useEvent } from "../../hooks/useEvent";
import { fetchCompanyList } from "../../lib/api";
import { readCache, writeCache } from "../../lib/cache";
import { addComment, commentsWith } from "../../lib/comments";
import { exportEvent } from "../../lib/exportExcel";
import { itemCache, useCached, useLiveRows, useUnits } from "../../lib/live";
import { categoryOptions, filterRequests, isFiltering, NO_FILTER } from "../../lib/requestFilter";
import { addRequest, collectSection, isCollectable, restoreRequest } from "../../lib/requests";
import { useProfile } from "../../lib/session";
import { formatNeededBy } from "../../lib/time";
import type { List, ListComment, Request, RequestStatus } from "../../lib/types";
import { RequestRow } from "../../components/RequestRow";
import { RequestSheet } from "./RequestSheet";
import { t } from "../../strings";

const FILTER_STATUSES: RequestStatus[] = ["pending", "ready", "partial", "missing", "collected", "cancelled"];

export function CustomerEvent() {
  const { id } = useParams();
  const profile = useProfile();
  const showToast = useToast();
  const { event } = useEvent(id);
  // undefined while loading; null when the company has no list here.
  const [list, setList] = useState<List | null | undefined>(undefined);
  const [editing, setEditing] = useState<Request | null>(null);
  const [filter, setFilter] = useState(NO_FILTER);
  const units = useUnits();
  const suppliers = units.filter((u) => u.kind === "supplier" && u.active);

  // The saved list opens the screen with no signal; the server's replaces it.
  useEffect(() => {
    if (!id) return;
    const key = `list:${id}`;
    setList(readCache<List>(key) ?? undefined);
    fetchCompanyList(id, profile.unit_id!)
      .then((l) => {
        setList(l);
        if (l) writeCache(key, l);
      })
      .catch(() => setList((current) => current ?? null));
  }, [id, profile.unit_id]);

  const { rows } = useLiveRows<Request>("requests", {
    column: "list_id", value: list?.id, cacheKey: list ? `requests:list:${list.id}` : undefined,
  });
  const itemOf = useCached(itemCache, rows.map((r) => r.item_id));
  const { rows: comments } = useLiveRows<ListComment>("list_comments", {
    column: "list_id", value: list?.id, cacheKey: list ? `comments:list:${list.id}` : undefined,
  });

  if (event === undefined || list === undefined) return <Layout title={t.loading} back>{null}</Layout>;
  if (!event || !list) return <Layout title={t.genericError} back>{null}</Layout>;

  const editable = event.status === "open";
  const categoryOf = (r: Request) => itemOf(r.item_id)?.category;
  const filtering = isFiltering(filter);
  const shown = filterRequests(rows, filter, categoryOf);
  const side = editable ? "customer" as const : null;
  const writerName = (c: ListComment) => units.find((u) => u.id === (c.side === "customer" ? c.company_id : c.supplier_id))?.name ?? "";
  const comment = (supplierId: string | null) => (body: string) => addComment({
    listId: list.id, eventId: event.id, companyId: list.company_id, supplierId, side: "customer", body,
  });
  const generalComments = commentsWith(comments, null);
  const neededBy = formatNeededBy(event);

  const collect = (supplierId: string, sectionRows: Request[]) => {
    const ready = sectionRows.filter(isCollectable);
    collectSection(list.id, supplierId, sectionRows);
    showToast({
      message: `${t.collected} ✓`,
      // Undo uses the rows as they were before the pickup.
      onAction: () => ready.forEach((r) => restoreRequest({ ...r, status: "collected", previous_status: r.status })),
    });
  };


  return (
    <Layout
      title={event.name}
      back
      actions={<button className="btn btn-ghost btn-small" onClick={() => exportEvent(event.id, event.name)}>{t.exportExcel}</button>}
    >
      {neededBy && <p className="muted">{t.neededBy} {neededBy}</p>}
      {!editable && <p className="notice">{event.status === "cancelled" ? t.eventCancelled : t.readOnly}</p>}

      {(editable || generalComments.length > 0) && (
        <section className="section">
          <h2 className="section-title">{t.generalComments}</h2>
          <CommentThread comments={generalComments} writerName={writerName} side={side} onAdd={comment(null)}
            placeholder={t.commentToAll} />
        </section>
      )}

      {rows.length > 0 && (
        <div className="toolbar">
          <RequestFilters filter={filter} onChange={setFilter} categories={categoryOptions(rows, categoryOf)}
            statuses={FILTER_STATUSES} />
        </div>
      )}
      {filtering && shown.length === 0 && <p className="muted empty">{t.noRequestsMatch}</p>}

      {suppliers.map((s) => {
        // "אספתי" collects the whole section, not only the rows a filter shows.
        const sectionRows = rows.filter((r) => r.supplier_id === s.id);
        const shownRows = shown.filter((r) => r.supplier_id === s.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const canCollect = sectionRows.some(isCollectable);
        if (filtering && shownRows.length === 0) return null;
        return (
          <section key={s.id} className="section">
            <h2 className="section-title">{s.name}</h2>
            <CategorizedList rows={shownRows} categoryOf={categoryOf} renderRow={(r) => (
              <RequestRow key={r.id} request={r} item={itemOf(r.item_id)} editable={editable}
                onOpen={() => setEditing(r)} />
            )} />
            <CommentThread comments={commentsWith(comments, s.id)} writerName={writerName} side={side}
              onAdd={comment(s.id)} placeholder={t.commentTo(s.name)} />
            {editable && (
              <ItemAdder supplierId={s.id} onAdd={(itemId, quantity, measure) => addRequest({
                listId: list.id, eventId: event.id, companyId: list.company_id, supplierId: s.id, itemId, quantity, measure,
              })} />
            )}
            {editable && canCollect && (
              <button className="btn btn-success btn-block" onClick={() => collect(s.id, sectionRows)}>{t.collected}</button>
            )}
          </section>
        );
      })}

      <EventEndButtons event={event}
        canClose={event.scope === "company" || event.created_by === profile.id}
        canCancel={event.created_by === profile.id} />

      {editing && (
        <RequestSheet request={rows.find((r) => r.id === editing.id) ?? editing} item={itemOf(editing.item_id)}
          onClose={() => setEditing(null)} />
      )}
    </Layout>
  );
}
