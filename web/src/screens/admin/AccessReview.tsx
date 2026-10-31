// Everyone with more than a company's access, so stale admin and supplier
// accounts get noticed and deactivated.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { fetchAccessReview } from "../../lib/api";
import { useUnits } from "../../lib/live";
import type { AccessReviewRow } from "../../lib/types";
import { useUsers } from "../../hooks/useUsers";
import { t } from "../../strings";

export function AccessReview() {
  const units = useUnits();
  const { users } = useUsers();
  const [rows, setRows] = useState<AccessReviewRow[] | null>(null);
  useEffect(() => {
    fetchAccessReview().then(setRows).catch(() => setRows([]));
  }, []);

  const nameOf = (id: string) => {
    const u = users?.find((x) => x.id === id);
    return u ? `${u.first_name} ${u.last_name}` : id.slice(0, 8);
  };

  return (
    <Layout title={t.accessReview} back>
      <p className="muted">{t.accessReviewHint}</p>
      <ul className="req-list">
        {rows?.map((r) => (
          <li key={r.user_id} className={`req ${r.active ? "" : "req-cancelled"}`}>
            <div className="req-main">
              <Link className="req-name" dir="auto" to={`/users/${r.user_id}`}>{nameOf(r.user_id)}</Link>
              <span className="muted">{t.roleLabels[r.role]} {units.find((u) => u.id === r.unit_id)?.name ?? ""}</span>
              {!r.active && <span className="tag">{t.inactive}</span>}
            </div>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
