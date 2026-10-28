// Everyone with more than a company's access, with their last change, so
// stale admin and supplier accounts get noticed and deactivated. Also the
// join code new users sign up with, rotated on the same monthly review.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDateTime } from "../../../../supabase/functions/_shared/excel.ts";
import { Layout } from "../../components/Layout";
import { fetchAccessReview, fetchJoinCode, rotateJoinCode } from "../../lib/api";
import { describeError } from "../../lib/errors";
import { useUnits } from "../../lib/live";
import type { AccessReviewRow } from "../../lib/types";
import { useUsers } from "./useUsers";
import { t } from "../../strings";

export function AccessReview() {
  const units = useUnits();
  const { users } = useUsers();
  const [rows, setRows] = useState<AccessReviewRow[] | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchAccessReview().then(setRows).catch(() => setRows([]));
    fetchJoinCode().then(setJoinCode).catch((e) => setError(describeError(e)));
  }, []);

  const rotate = async () => {
    if (!window.confirm(t.rotateJoinCodeConfirm)) return;
    setError(null);
    try {
      setJoinCode(await rotateJoinCode());
    } catch (e) {
      setError(describeError(e));
    }
  };

  const nameOf = (id: string) => {
    const u = users?.find((x) => x.id === id);
    return u ? `${u.first_name} ${u.last_name}` : id.slice(0, 8);
  };

  return (
    <Layout title={t.accessReview} back>
      <section className="stack">
        <h2>{t.joinCodeTitle}</h2>
        <p className="muted">{t.joinCodeAdminHint}</p>
        {joinCode && <code dir="ltr" className="secret">{joinCode}</code>}
        <button className="btn" onClick={rotate}>{t.rotateJoinCode}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <p className="muted">{t.accessReviewHint}</p>
      <ul className="req-list">
        {rows?.map((r) => (
          <li key={r.user_id} className={`req ${r.active ? "" : "req-cancelled"}`}>
            <div className="req-main">
              <Link className="req-name" dir="auto" to={`/users/${r.user_id}`}>{nameOf(r.user_id)}</Link>
              <span className="muted">{t.roleLabels[r.role]} {units.find((u) => u.id === r.unit_id)?.name ?? ""}</span>
              {!r.active && <span className="tag">{t.inactive}</span>}
            </div>
            <div className="req-sub muted">
              <span>{t.lastChange}: {r.last_change_at ? formatDateTime(r.last_change_at) : t.never}</span>
            </div>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
