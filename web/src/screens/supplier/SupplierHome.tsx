// "What do I still need to prepare": who is signed in and for which unit,
// then every open request for this supplier, by event, company and item
// category, urgent first. The aggregate view sums each item across companies for pulling
// stock in one pass.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CategorizedList } from "../../components/CategorizedList";
import { Layout } from "../../components/Layout";
import { ProfileCard } from "../../components/ProfileCard";
import { SupplierSwitcher } from "../../components/SupplierSwitcher";
import { useAction, useToast } from "../../components/Toast";
import { mergeItem, mergeSuggestions, updateItem } from "../../lib/api";
import { exportOpenRequests, exportTotals } from "../../lib/exportExcel";
import { eventCache, itemCache, useCached, useLiveRows, useRealtime, useUnits } from "../../lib/live";
import { acknowledgeCancel, setStatus } from "../../lib/requests";
import { useActiveSupplier } from "../../lib/activeSupplier";
import { useProfile } from "../../lib/session";
import { formatNeededBy } from "../../lib/time";
import type { LogisticsEvent, MergeSuggestion, Request } from "../../lib/types";
import { PushPrompt } from "../shared/PushPrompt";
import { unitUsersNav } from "../shared/unitUsers";
import { AggregateView, aggregateTotals } from "./AggregateView";
import { SupplierRequestSheet } from "./SupplierRequestSheet";
import { SupplierRow } from "./SupplierRow";
import { groupByEventAndCompany } from "./supplierGroups";
import { t } from "../../strings";

type View = "byCompany" | "aggregate";

const byNeededAt = (a: LogisticsEvent, b: LogisticsEvent) =>
  a.needed_at.localeCompare(b.needed_at) || a.created_at.localeCompare(b.created_at);

export function SupplierHome() {
  const profile = useProfile();
  const supplierId = useActiveSupplier();
  const { id: routeEventId } = useParams();
  const showToast = useToast();
  const runAction = useAction();
  const units = useUnits();
  const [view, setView] = useState<View>("byCompany");
  const [eventFilter, setEventFilter] = useState(routeEventId ?? "");
  const [menuFor, setMenuFor] = useState<Request | null>(null);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);

  useEffect(() => setEventFilter(routeEventId ?? ""), [routeEventId]);

  const { rows, refetch } = useLiveRows<Request>("requests", {
    column: "supplier_id",
    value: supplierId,
    source: "open_requests",
    narrow: (q) => q.neq("status", "collected"),
    keep: (r) => r.status !== "collected",
    cacheKey: `requests:supplier:${supplierId}`,
  });
  const itemOf = useCached(itemCache, rows.map((r) => r.item_id));
  const eventOf = useCached(eventCache, rows.map((r) => r.event_id));
  useRealtime<LogisticsEvent>("events", "", (c) => {
    if (c.eventType === "UPDATE") eventCache.put([c.new as LogisticsEvent]);
  });

  const loadSuggestions = useCallback(() => {
    mergeSuggestions(supplierId).then(setSuggestions).catch(() => setSuggestions([]));
  }, [supplierId]);
  const unverifiedCount = rows.filter((r) => itemOf(r.item_id)?.verified === false).length;
  useEffect(loadSuggestions, [loadSuggestions, unverifiedCount]);

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
  const shown = useMemo(() => (eventFilter ? open.filter((r) => r.event_id === eventFilter) : open), [open, eventFilter]);
  const unitNames = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units]);
  const companyName = useCallback((id: string) => unitNames.get(id) ?? "", [unitNames]);
  const groups = useMemo(() => groupByEventAndCompany(shown, companyName), [shown, companyName]);
  const suggestionOf = useMemo(() => new Map(suggestions.map((s) => [s.item_id, s])), [suggestions]);

  const markReady = (r: Request) => {
    if (r.status === "ready") return setMenuFor(r);
    setStatus(r, "ready");
    offerUndo(r, t.markedReady);
  };
  const offerUndo = (before: Request, message = t.statusChanged) =>
    showToast({ message, onAction: () => setStatus(before, before.status, before.supplied_quantity) });

  const merge = (s: MergeSuggestion) =>
    runAction(() => mergeItem(s.item_id, s.suggested_id), async () => { await refetch(); loadSuggestions(); });
  const verify = (itemId: string) =>
    runAction(() => updateItem(itemId, { verified: true }), () => itemCache.put([{ ...itemOf(itemId)!, verified: true }]));

  // Stable handlers for the memoized rows, calling this render's functions.
  const latest = useRef({ markReady, setMenuFor, merge, verify });
  latest.current = { markReady, setMenuFor, merge, verify };
  const rowHandlers = useMemo(() => ({
    onTap: (r: Request) => latest.current.markReady(r),
    onMenu: (r: Request) => latest.current.setMenuFor(r),
    onAcknowledge: acknowledgeCancel,
    onMerge: (s: MergeSuggestion) => latest.current.merge(s),
    onVerify: (itemId: string) => latest.current.verify(itemId),
  }), []);

  // Events ordered by when they are needed; urgent events first.
  const eventsShown = openEvents
    .filter((e) => !eventFilter || e.id === eventFilter)
    .sort((a, b) => Number(shown.some((r) => r.event_id === b.id && r.urgent)) - Number(shown.some((r) => r.event_id === a.id && r.urgent)));

  return (
    <Layout
      title={t.appName}
      nav={[{ to: "/catalog", label: t.catalog }, { to: "/history", label: t.history }, ...unitUsersNav(profile)]}
      actions={
        <button className="btn btn-ghost btn-small"
          onClick={() => view === "aggregate"
            ? exportTotals(aggregateTotals(shown, itemOf, units))
            : exportOpenRequests(eventFilter || undefined)}>
          {t.exportExcel}
        </button>
      }
    >
      <PushPrompt />
      <ProfileCard profile={profile} units={units} activeUnitId={supplierId} />
      <SupplierSwitcher />
      <div className="toolbar">
        <div className="segmented">
          <button className={view === "byCompany" ? "active" : ""} onClick={() => setView("byCompany")}>{t.byCompany}</button>
          <button className={view === "aggregate" ? "active" : ""} onClick={() => setView("aggregate")}>{t.aggregate}</button>
        </div>
        <select className="input" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} aria-label={t.allEvents}>
          <option value="">{t.allEvents}</option>
          {openEvents.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {shown.length === 0 && <p className="muted empty">{t.nothingToPrepare}</p>}

      {view === "aggregate" ? (
        <AggregateView requests={shown} itemOf={itemOf} units={units} />
      ) : eventsShown.map((e) => {
        const companies = groups.get(e.id) ?? [];
        return (
          <section key={e.id} className="section">
            <h2 className="section-title">
              <span dir="auto">{e.name}</span>
              {formatNeededBy(e) && <span className="muted"> · {t.neededBy} {formatNeededBy(e)}</span>}
            </h2>
            {companies.map((c) => (
              <div key={c.companyId} className="company-group">
                <h3 className="company-title">{companyName(c.companyId)}</h3>
                <CategorizedList rows={c.rows}
                  categoryOf={(r) => itemOf(r.item_id)?.category} renderRow={(r) => (
                    <SupplierRow key={r.id} request={r} item={itemOf(r.item_id)}
                      suggestion={suggestionOf.get(r.item_id)} {...rowHandlers} />
                  )} />
              </div>
            ))}
          </section>
        );
      })}

      {menuFor && (
        <SupplierRequestSheet request={rows.find((r) => r.id === menuFor.id) ?? menuFor} item={itemOf(menuFor.item_id)}
          onClose={() => setMenuFor(null)} onStatusChanged={(before) => offerUndo(before)} />
      )}
    </Layout>
  );
}
