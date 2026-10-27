// The company's list in one event: a section per supplier, in the admin's
// order, each a live checklist ending with an add row and "אספתי".
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ItemAdder } from "../../components/ItemAdder";
import { Layout } from "../../components/Layout";
import { useAction, useToast } from "../../components/Toast";
import { useEvent } from "../../hooks/useEvent";
import { cancelEvent, closeEvent, fetchCompanyList } from "../../lib/api";
import { readCache, writeCache } from "../../lib/cache";
import { exportEvent } from "../../lib/exportExcel";
import { itemCache, useCached, useLiveRows, useUnits } from "../../lib/live";
import { addRequest, collectSection, isCollectable, restoreRequest } from "../../lib/requests";
import { useProfile } from "../../lib/session";
import { formatNeededBy } from "../../lib/time";
import type { List, Request } from "../../lib/types";
import { RequestRow } from "../../components/RequestRow";
import { RequestSheet } from "./RequestSheet";
import { t } from "../../strings";

export function CustomerEvent() {
  const { id } = useParams();
  const profile = useProfile();
  const navigate = useNavigate();
  const showToast = useToast();
  const runAction = useAction();
  const { event } = useEvent(id);
  // undefined while loading; null when the company has no list here.
  const [list, setList] = useState<List | null | undefined>(undefined);
  const [editing, setEditing] = useState<Request | null>(null);
  const suppliers = useUnits().filter((u) => u.kind === "supplier" && u.active);

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

  if (event === undefined || list === undefined) return <Layout title={t.loading} back>{null}</Layout>;
  if (!event || !list) return <Layout title={t.genericError} back>{null}</Layout>;

  const editable = event.status === "open";
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

  const run = (action: () => Promise<void>) => runAction(action, () => navigate("/"));

  return (
    <Layout
      title={event.name}
      back
      actions={<button className="btn btn-ghost btn-small" onClick={() => exportEvent(event.id, event.name)}>{t.exportExcel}</button>}
    >
      {neededBy && <p className="muted">{t.neededBy} {neededBy}</p>}
      {!editable && <p className="notice">{event.status === "cancelled" ? t.eventCancelled : t.readOnly}</p>}

      {suppliers.map((s) => {
        const sectionRows = rows.filter((r) => r.supplier_id === s.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const canCollect = sectionRows.some(isCollectable);
        return (
          <section key={s.id} className="section">
            <h2 className="section-title">{s.name}</h2>
            <ul className="req-list">
              {sectionRows.map((r) => (
                <RequestRow key={r.id} request={r} item={itemOf(r.item_id)} editable={editable}
                  onOpen={() => setEditing(r)} />
              ))}
            </ul>
            {editable && (
              <ItemAdder supplierId={s.id} onAdd={(itemId, quantity) => addRequest({
                listId: list.id, eventId: event.id, companyId: list.company_id, supplierId: s.id, itemId, quantity,
              })} />
            )}
            {editable && canCollect && (
              <button className="btn btn-success btn-block" onClick={() => collect(s.id, sectionRows)}>{t.collected}</button>
            )}
          </section>
        );
      })}

      {editable && (
        <div className="danger-zone">
          {(event.scope === "company" || event.created_by === profile.id) && (
            <button className="btn btn-secondary" onClick={() => run(() => closeEvent(event.id))}>{t.closeEvent}</button>
          )}
          {event.created_by === profile.id && (
            <button className="btn btn-danger" onClick={() => run(() => cancelEvent(event.id))}>{t.cancelEvent}</button>
          )}
        </div>
      )}

      {editing && (
        <RequestSheet request={rows.find((r) => r.id === editing.id) ?? editing} item={itemOf(editing.item_id)}
          onClose={() => setEditing(null)} />
      )}
    </Layout>
  );
}
