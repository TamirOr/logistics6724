// Every user, with deactivate and move to another unit, company or
// supplier (the server changes the role to match).
import { useState } from "react";
import { Layout } from "../../components/Layout";
import { Sheet } from "../../components/Sheet";
import { useAction } from "../../components/Toast";
import { moveUser, setUserActive } from "../../lib/api";
import { useUnits } from "../../lib/live";
import { useProfile } from "../../lib/session";
import type { Profile, UnitKind } from "../../lib/types";
import { useUsers } from "./useUsers";
import { t } from "../../strings";

export function AdminUsers() {
  const me = useProfile();
  const runAction = useAction();
  const units = useUnits();
  const { users, reload } = useUsers();
  const [moving, setMoving] = useState<Profile | null>(null);

  const act = (action: () => Promise<void>) => runAction(action, reload);
  const unitName = (id: string | null) => units.find((u) => u.id === id)?.name ?? "";

  return (
    <Layout title={t.users} back>
      <ul className="req-list">
        {users?.filter((u) => u.approval === "approved").map((u) => (
          <li key={u.id} className={`req ${u.active ? "" : "req-cancelled"}`}>
            <div className="req-main">
              <span className="req-name" dir="auto">{u.first_name} {u.last_name}</span>
              <span className="muted">{t.roleLabels[u.role]} {unitName(u.unit_id)}</span>
              {u.id === me.id && <span className="tag">{t.me}</span>}
              {!u.active && <span className="tag">{t.inactive}</span>}
            </div>
            {u.role !== "admin" && (
              <button className="btn btn-ghost btn-small" onClick={() => setMoving(u)}>{t.moveToUnit}</button>
            )}
            {/* The server refuses it too: an admin could lock themselves out. */}
            {u.id !== me.id && (
              <button className="btn btn-ghost btn-small" onClick={() => act(() => setUserActive(u.id, !u.active))}>
                {u.active ? t.deactivate : t.activate}
              </button>
            )}
          </li>
        ))}
      </ul>
      {moving && (
        <Sheet title={`${t.moveToUnit}: ${moving.first_name} ${moving.last_name}`} onClose={() => setMoving(null)}>
          <div className="stack">
            <p className="muted">{t.moveChangesRole}</p>
            {(["company", "supplier"] as UnitKind[]).map((kind) => (
              <section key={kind} className="stack">
                <h3 className="company-title">{kind === "company" ? t.kindCompany : t.kindSupplier}</h3>
                {units.filter((u) => u.active && u.kind === kind).map((u) => (
                  <button key={u.id} className="btn btn-secondary btn-block" disabled={u.id === moving.unit_id}
                    onClick={() => { act(() => moveUser(moving.id, u.id)); setMoving(null); }}>{u.name}</button>
                ))}
              </section>
            ))}
          </div>
        </Sheet>
      )}
    </Layout>
  );
}
