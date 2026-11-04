// A super user's screen: users waiting for their unit's approval, then the
// active soldiers of their units, each removable from them. A company's
// super user also moves its soldiers between the front and rear echelons.
import { Layout } from "../../components/Layout";
import { PendingSignups } from "../../components/PendingSignups";
import { useAction } from "../../components/Toast";
import { useUsers } from "../../hooks/useUsers";
import { removeFromUnit, setEchelon } from "../../lib/api";
import { isRear, otherEchelon } from "../../lib/echelon";
import { useUnits } from "../../lib/live";
import { useProfile } from "../../lib/session";
import type { Profile } from "../../lib/types";
import { unitNamesOf } from "../../lib/userUnits";
import { splitUnitUsers } from "./unitUsers";
import { t } from "../../strings";

export function UnitUsers() {
  const me = useProfile();
  const runAction = useAction();
  const units = useUnits();
  const { users, reload } = useUsers();
  const { pending, members } = splitUnitUsers(users ?? [], me);

  const act = (action: () => Promise<void>) => runAction(action, reload);
  const remove = (u: Profile) => {
    if (window.confirm(t.confirmRemoveFromUnit[me.role](`${u.first_name} ${u.last_name}`))) act(() => removeFromUnit(u.id));
  };

  return (
    <Layout title={t.unitUsers[me.role]} back>
      <PendingSignups pending={pending} units={units} act={act} />

      <h2 className="section-title">{t.unitMembers} <span className="muted count">({members.length})</span></h2>
      {members.length <= 1 && <p className="muted empty">{t.noUnitMembers}</p>}
      {members.map((u) => (
        <article key={u.id} className="card row member">
          <div className="member-name">
            <div dir="auto">
              {u.first_name} {u.last_name}
              {u.id === me.id && <> <span className="tag">{t.me}</span></>}
              {u.super_user && <> <span className="tag">{t.superUser}</span></>}
              {isRear(u) && <> <span className="tag">{t.echelonLabels.rear}</span></>}
            </div>
            <div className="muted">{unitNamesOf(u, units)}</div>
          </div>
          {u.role === "customer" && u.id !== me.id && (
            <button className="btn btn-ghost btn-small" onClick={() => act(() => setEchelon(u.id, otherEchelon(u)))}>
              {t.moveToEchelon[otherEchelon(u)]}
            </button>
          )}
          {u.id !== me.id && (
            <button className="btn btn-ghost btn-small" onClick={() => remove(u)}>{t.removeFromUnit[me.role]}</button>
          )}
        </article>
      ))}
    </Layout>
  );
}
