// "What do I still need to prepare": every open request for this supplier,
// by event and company, urgent first. The aggregate view sums each item
// across companies for pulling stock in one pass.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { useAction, useToast } from "../../components/Toast";
import { mergeItem, mergeSuggestions, updateItem } from "../../lib/api";
import { exportOpenRequests, exportTotals } from "../../lib/exportExcel";
import { eventCache, itemCache, useCached, useLiveRows, useRealtime, useUnits } from "../../lib/live";
import { acknowledgeCancel, setStatus } from "../../lib/requests";
import { useProfile } from "../../lib/session";
import { formatNeededBy } from "../../lib/time";
import type { LogisticsEvent, MergeSuggestion, Request } from "../../lib/types";
import { PushPrompt } from "../shared/PushPrompt";
import { AggregateView, aggregateTotals } from "./AggregateView";
import { SupplierRequestSheet } from "./SupplierRequestSheet";
import { SupplierRow } from "./SupplierRow";
import { t } from "../../strings";

type View = "byCompany" | "aggregate";

const byUrgencyThenAge = (a: Request, b: Request) =>
  Number(b.urgent) - Number(a.urgent) || a.created_at.localeCompare(b.created_at);

const byNeededAt = (a: LogisticsEvent, b: LogisticsEvent) =>
  a.needed_at.localeCompare(b.needed_at) || a.created_at.localeCompare(b.created_at);

export function SupplierHome() {
  const profile = useProfile();
  const supplierId = profile.unit_id!;
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
  const shown = eventFilter ? open.filter((r) => r.event_id === eventFilter) : open;
  const companyName = (id: string) => units.find((u) => u.id === id)?.name ?? "";

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

  // Events ordered by when they are needed; urgent events first.
  const eventsShown = openEvents
    .filter((e) => !eventFilter || e.id === eventFilter)
    .sort((a, b) => Number(shown.some((r) => r.event_id === b.id && r.urgent)) - Number(shown.some((r) => r.event_id === a.id && r.urgent)));

  return (
    <Layout
      title={t.appName}
      nav={[{ to: "/catalog", label: t.catalog }, { to: "/history", label: t.history }]}
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
        const eventRows = shown.filter((r) => r.event_id === e.id);
        const companies = [...new Set(eventRows.map((r) => r.company_id))]
          .sort((a, b) => companyName(a).localeCompare(companyName(b), "he"));
        return (
          <section key={e.id} className="section">
            <h2 className="section-title">
              <span dir="auto">{e.name}</span>
              {formatNeededBy(e) && <span className="muted"> · {t.neededBy} {formatNeededBy(e)}</span>}
            </h2>
            {companies.map((c) => (
              <div key={c} className="company-group">
                <h3 className="company-title">{companyName(c)}</h3>
                <ul className="req-list">
                  {eventRows.filter((r) => r.company_id === c).sort(byUrgencyThenAge).map((r) => (
                    <SupplierRow key={r.id} request={r} item={itemOf(r.item_id)}
                      suggestion={suggestions.find((s) => s.item_id === r.item_id)}
                      onTap={() => markReady(r)} onMenu={() => setMenuFor(r)}
                      onAcknowledge={() => acknowledgeCancel(r)} onMerge={merge} onVerify={() => verify(r.item_id)} />
                  ))}
                </ul>
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
