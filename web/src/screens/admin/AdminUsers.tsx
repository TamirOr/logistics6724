// Approved users in a table per side: suppliers, then customers, then
// admins. The supplier and customer tables filter by unit and by active.
// Each user can be deactivated or moved to another unit, company or
// supplier (the server changes the role to match). A name opens the
// user's support view.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { Sheet } from "../../components/Sheet";
import { useAction } from "../../components/Toast";
import { moveUser, setUserActive } from "../../lib/api";
import { useUnits } from "../../lib/live";
import { useProfile } from "../../lib/session";
import type { Profile, Unit, UnitKind, UserRole } from "../../lib/types";
import { useUsers } from "./useUsers";
import { filterUsers, NO_FILTER, toggleUnit, unitNamesOf, type ActiveFilter, type UserFilter } from "./users";
import { t } from "../../strings";

const ACTIVE_FILTERS: ActiveFilter[] = ["all", "active", "inactive"];

export function AdminUsers() {
  const runAction = useAction();
  const units = useUnits();
  const { users, reload } = useUsers();
  const [moving, setMoving] = useState<Profile | null>(null);

  const act = (action: () => Promise<void>) => runAction(action, reload);
  const approved = (role: UserRole) => users?.filter((u) => u.approval === "approved" && u.role === role) ?? [];
  const table = { units, onMove: setMoving, onSetActive: (u: Profile) => act(() => setUserActive(u.id, !u.active)) };

  return (
    <Layout title={t.users} back actions={<Link className="btn btn-ghost btn-small" to="/access">{t.accessReview}</Link>}>
      <UserTable title={t.suppliersTable} users={approved("supplier")} filterKind="supplier" {...table} />
      <UserTable title={t.customersTable} users={approved("customer")} filterKind="company" {...table} />
      <UserTable title={t.adminsTable} users={approved("admin")} {...table} />
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

interface UserTableProps {
  title: string;
  users: Profile[];
  units: Unit[];
  /** The kind of unit to filter by; no filters without it. */
  filterKind?: UnitKind;
  onMove: (user: Profile) => void;
  onSetActive: (user: Profile) => void;
}

function UserTable({ title, users, units, filterKind, onMove, onSetActive }: UserTableProps) {
  const me = useProfile();
  const [filter, setFilter] = useState<UserFilter>(NO_FILTER);
  const shown = filterUsers(users, filter);

  return (
    <section className="section">
      <h2 className="section-title">{title} <span className="muted count">({shown.length})</span></h2>
      {filterKind && (
        <div className="stack filters">
          <div className="chips" role="group" aria-label={t.filterByUnit}>
            {units.filter((u) => u.kind === filterKind).map((u) => (
              <button key={u.id} className={`chip ${filter.unitIds.includes(u.id) ? "active" : ""}`}
                aria-pressed={filter.unitIds.includes(u.id)} onClick={() => setFilter(toggleUnit(filter, u.id))}>
                {u.name}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label={t.filterByActive}>
            {ACTIVE_FILTERS.map((a) => (
              <button key={a} className={filter.active === a ? "active" : ""} aria-pressed={filter.active === a}
                onClick={() => setFilter({ ...filter, active: a })}>{t.activeFilters[a]}</button>
            ))}
          </div>
        </div>
      )}
      {shown.length === 0 ? <p className="muted empty">{t.noUsersMatch}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>{t.name}</th><th>{t.unit}</th><th>{t.userState}</th><th aria-label={t.actions} /></tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={u.active ? "" : "row-inactive"}>
                  <td>
                    <Link dir="auto" to={`/users/${u.id}`}>{u.first_name} {u.last_name}</Link>
                    {u.id === me.id && <> <span className="tag">{t.me}</span></>}
                  </td>
                  <td>{unitNamesOf(u, units)}</td>
                  <td>{u.active ? t.active : <span className="tag">{t.inactive}</span>}</td>
                  <td className="table-actions">
                    {u.role !== "admin" && (
                      <button className="btn btn-ghost btn-small" onClick={() => onMove(u)}>{t.moveToUnit}</button>
                    )}
                    {/* The server refuses it too: an admin could lock themselves out. */}
                    {u.id !== me.id && (
                      <button className="btn btn-ghost btn-small" onClick={() => onSetActive(u)}>
                        {u.active ? t.deactivate : t.activate}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
