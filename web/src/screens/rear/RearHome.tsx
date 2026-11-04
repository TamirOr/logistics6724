// "What do we still need to pick up": the rear echelon's screen. Every
// request of its company in open events, by event, supplier unit and item
// category, urgent first and collected last. One tap marks a request
// collected, the menu sets any other status, and "אספתי" collects a whole
// section. Comments sit where the company's front writes them: to every
// supplier on top of an event, to one supplier in its section, on a request
// in its sheet. Filters by event, item category and status, like the
// supplier's screen.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CategorizedList } from "../../components/CategorizedList";
import { CommentThread } from "../../components/CommentThread";
import { EchelonSwitcher } from "../../components/EchelonSwitcher";
import { Layout } from "../../components/Layout";
import { ProfileCard } from "../../components/ProfileCard";
import { RequestFilters } from "../../components/RequestFilters";
import { useToast } from "../../components/Toast";
import { useCollectSection } from "../../hooks/useCollectSection";
import { addComment, commentsOn, commentsWith, commentWriter } from "../../lib/comments";
import { eventCache, itemCache, useCached, useLiveRows, useUnits } from "../../lib/live";
import { categoryOptions, filterRequests, NO_FILTER } from "../../lib/requestFilter";
import { isCollectable, markStatus, undoMark } from "../../lib/requests";
import { useProfile } from "../../lib/session";
import { formatNeededBy } from "../../lib/time";
import type { ListComment, LogisticsEvent, Request, RequestStatus } from "../../lib/types";
import { PushPrompt } from "../shared/PushPrompt";
import { unitUsersNav } from "../shared/unitUsers";
import { RearRequestSheet } from "./RearRequestSheet";
import { RearRow } from "./RearRow";
import { t } from "../../strings";

const FILTER_STATUSES: RequestStatus[] = ["pending", "ready", "partial", "missing", "collected", "cancelled"];

const isDone = (r: Request) => r.status === "collected" || r.status === "cancelled";

const byUrgencyThenAge = (a: Request, b: Request) =>
  Number(isDone(a)) - Number(isDone(b)) || Number(b.urgent) - Number(a.urgent) || a.created_at.localeCompare(b.created_at);

const byNeededAt = (a: LogisticsEvent, b: LogisticsEvent) =>
  a.needed_at.localeCompare(b.needed_at) || a.created_at.localeCompare(b.created_at);

export function RearHome() {
  const profile = useProfile();
  const companyId = profile.unit_id!;
  const { id: routeEventId } = useParams();
  const showToast = useToast();
  const collect = useCollectSection();
  const units = useUnits();
  const suppliers = units.filter((u) => u.kind === "supplier");
  const [eventFilter, setEventFilter] = useState(routeEventId ?? "");
  const [filter, setFilter] = useState(NO_FILTER);
  const [menuFor, setMenuFor] = useState<Request | null>(null);

  useEffect(() => setEventFilter(routeEventId ?? ""), [routeEventId]);

  const { rows } = useLiveRows<Request>("requests", {
    column: "company_id", value: companyId, source: "open_requests", cacheKey: `requests:company:${companyId}`,
  });
  const { rows: comments } = useLiveRows<ListComment>("list_comments", {
    column: "company_id", value: companyId, cacheKey: `comments:company:${companyId}`,
  });
  const itemOf = useCached(itemCache, rows.map((r) => r.item_id));
  const eventOf = useCached(eventCache, rows.map((r) => r.event_id));

  // Only requests of open events; an event not loaded yet still shows.
  const open = useMemo(
    () => rows.filter((r) => (eventOf(r.event_id)?.status ?? "open") === "open"),
    [rows, eventOf],
  );
  const openEvents = useMemo(
    () => [...new Set(open.map((r) => r.event_id))].map((id) => eventOf(id))
      .filter((e): e is LogisticsEvent => !!e).sort(byNeededAt),
    [open, eventOf],
  );
  const categoryOf = (r: Request) => itemOf(r.item_id)?.category;
  const inEvent = eventFilter ? open.filter((r) => r.event_id === eventFilter) : open;
  const shown = filterRequests(inEvent, filter, categoryOf);
  const writerName = commentWriter(units);

  const offerUndo = (before: Request, status: RequestStatus, message = t.statusChanged) =>
    showToast({ message, onAction: () => undoMark(before, status) });
  const markCollected = (r: Request) => {
    if (r.status === "collected") return setMenuFor(r);
    markStatus(r, "collected");
    offerUndo(r, "collected", t.markedCollected);
  };

  return (
    <Layout title={t.toCollect} nav={[{ to: "/history", label: t.history }, ...unitUsersNav(profile)]}>
      <PushPrompt />
      <ProfileCard profile={profile} units={units} activeUnitId={companyId} />
      <EchelonSwitcher />
      <div className="toolbar">
        <select className="input" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} aria-label={t.allEvents}>
          <option value="">{t.allEvents}</option>
          {openEvents.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <RequestFilters filter={filter} onChange={setFilter} categories={categoryOptions(inEvent, categoryOf)}
          statuses={FILTER_STATUSES} />
      </div>

      {shown.length === 0 && (
        <p className="muted empty">{inEvent.length > 0 ? t.noRequestsMatch : t.nothingToCollect}</p>
      )}

      {openEvents.filter((e) => shown.some((r) => r.event_id === e.id)).map((e) => {
        const eventRows = shown.filter((r) => r.event_id === e.id);
        const listId = eventRows[0].list_id;
        const eventComments = comments.filter((c) => c.list_id === listId);
        const comment = (supplierId: string | null) => (body: string) =>
          addComment({ listId, eventId: e.id, companyId, supplierId, side: "customer", body });
        return (
          <section key={e.id} className="section">
            <h2 className="section-title">
              <span dir="auto">{e.name}</span>
              {formatNeededBy(e) && <span className="muted"> · {t.neededBy} {formatNeededBy(e)}</span>}
            </h2>
            <CommentThread comments={commentsWith(eventComments, null)} writerName={writerName} side="customer"
              onAdd={comment(null)} placeholder={t.commentToAll} />
            {suppliers.filter((s) => eventRows.some((r) => r.supplier_id === s.id)).map((s) => {
              // "אספתי" collects the whole section, not only the rows a filter shows.
              const sectionRows = open.filter((r) => r.event_id === e.id && r.supplier_id === s.id);
              return (
                <div key={s.id} className="company-group">
                  <h3 className="company-title">{s.name}</h3>
                  <CommentThread comments={commentsWith(eventComments, s.id)} writerName={writerName} side="customer"
                    onAdd={comment(s.id)} placeholder={t.commentTo(s.name)} />
                  <CategorizedList rows={eventRows.filter((r) => r.supplier_id === s.id).sort(byUrgencyThenAge)}
                    categoryOf={categoryOf} renderRow={(r) => (
                      <RearRow key={r.id} request={r} item={itemOf(r.item_id)} commentCount={commentsOn(eventComments, r.id).length}
                        onTap={() => markCollected(r)} onMenu={() => setMenuFor(r)} />
                    )} />
                  {sectionRows.some(isCollectable) && (
                    <button className="btn btn-success btn-block" onClick={() => collect(listId, s.id, sectionRows)}>
                      {t.collected}
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      {menuFor && (
        <RearRequestSheet request={rows.find((r) => r.id === menuFor.id) ?? menuFor} item={itemOf(menuFor.item_id)}
          onClose={() => setMenuFor(null)} onStatusChanged={offerUndo} />
      )}
    </Layout>
  );
}
