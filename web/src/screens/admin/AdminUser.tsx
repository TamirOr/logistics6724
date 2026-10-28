// One user's page: their profile, from the users list.
import { useParams } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { UserFields } from "../../components/UserFields";
import { useUsers } from "../../hooks/useUsers";
import { useUnits } from "../../lib/live";
import { t } from "../../strings";

export function AdminUser() {
  const { id = "" } = useParams();
  const { users } = useUsers();
  const units = useUnits();
  const user = users?.find((u) => u.id === id);

  return (
    <Layout title={user ? `${user.first_name} ${user.last_name}` : t.profile} back>
      {!user && <p className="muted">{t.loading}</p>}
      {user && (
        <>
          <h2 className="section-title">{t.profile}</h2>
          <UserFields user={user} units={units} />
          {!user.active && <p><span className="tag">{t.inactive}</span></p>}
        </>
      )}
    </Layout>
  );
}
