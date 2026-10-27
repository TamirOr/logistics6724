// Companies and suppliers: add, rename, set a company's headcount (סד״כ)
// and deactivate.
import { useEffect, useState } from "react";
import { Layout } from "../../components/Layout";
import { Sheet } from "../../components/Sheet";
import { useAction } from "../../components/Toast";
import { saveUnit } from "../../lib/api";
import { loadUnits } from "../../lib/live";
import type { Unit, UnitKind } from "../../lib/types";
import { t } from "../../strings";

type Draft = Omit<Unit, "id"> & { id?: string };
const KINDS: UnitKind[] = ["company", "supplier"];
const kindLabel = (k: UnitKind) => (k === "company" ? t.kindCompany : t.kindSupplier);

export function AdminUnits() {
  const runAction = useAction();
  const [units, setUnits] = useState<Unit[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const reload = () => loadUnits(true).then(setUnits);
  useEffect(() => {
    reload();
  }, []);

  const save = (d: Draft) => runAction(() => saveUnit(d), () => { setDraft(null); return reload(); });

  return (
    <Layout title={t.units} back
      bottom={<button className="btn btn-primary btn-big"
        onClick={() => setDraft({ name: "", kind: "company", headcount: null, active: true })}>{t.addUnit}</button>}>
      {KINDS.map((kind) => (
        <section key={kind} className="section">
          <h2 className="section-title">{kindLabel(kind)}</h2>
          <ul className="req-list">
            {units.filter((u) => u.kind === kind).map((u) => (
              <li key={u.id} className={`req ${u.active ? "" : "req-cancelled"}`}>
                <button className="req-main" onClick={() => setDraft(u)}>
                  <span className="req-name" dir="auto">{u.name}</span>
                  {u.headcount != null && <span className="muted">{t.headcountOf(u.headcount)}</span>}
                  {!u.active && <span className="tag">{t.inactive}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {draft && (
        <Sheet title={draft.id ? draft.name : t.addUnit} onClose={() => setDraft(null)}>
          <div className="stack">
            <label className="field"><span>{t.unitName}</span>
              <input className="input" dir="auto" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            {!draft.id && (
              <div className="segmented">
                {KINDS.map((k) => (
                  <button key={k} type="button" className={draft.kind === k ? "active" : ""}
                    onClick={() => setDraft({ ...draft, kind: k, headcount: k === "company" ? draft.headcount : null })}>
                    {kindLabel(k)}
                  </button>
                ))}
              </div>
            )}
            {draft.kind === "company" && (
              <label className="field"><span>{t.headcount}</span>
                <input className="input" inputMode="numeric" dir="ltr" value={draft.headcount ?? ""}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setDraft({ ...draft, headcount: digits ? Number(digits) : null });
                  }} />
              </label>
            )}
            <label className="switch">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              <span>{draft.active ? t.activate : t.inactive}</span>
            </label>
            <button className="btn btn-primary btn-block" disabled={!draft.name.trim()}
              onClick={() => save({ ...draft, name: draft.name.trim() })}>{t.save}</button>
          </div>
        </Sheet>
      )}
    </Layout>
  );
}
