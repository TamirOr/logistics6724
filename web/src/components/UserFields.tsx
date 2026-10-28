// A user's sign-up details: for admins on a pending sign-up and on the
// user's page, for a supplier on their own home screen.
import type { Profile, Unit } from "../lib/types";
import { unitNamesOf } from "../lib/userUnits";
import { t } from "../strings";

export function UserFields({ user, units }: { user: Profile; units: Unit[] }) {
  return (
    <dl className="facts">
      <dt>{t.serviceNumber}</dt><dd><bdi dir="ltr">{user.service_number}</bdi></dd>
      <dt>{t.emailLabel}</dt><dd><bdi dir="ltr">{user.email}</bdi></dd>
      <dt>{t.side}</dt><dd>{t.roleLabels[user.role]}</dd>
      <dt>{t.unit}</dt><dd>{unitNamesOf(user, units)}</dd>
    </dl>
  );
}
