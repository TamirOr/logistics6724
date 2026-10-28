// A user's sign-up details: for admins on a pending sign-up and on the
// user's page, for a supplier on their own home screen.
import type { Profile, Unit } from "../lib/types";
import { unitKindOf, unitNamesOf } from "../lib/userUnits";
import { t } from "../strings";

/** What the user is in their unit: a soldier, its responsible commander, or an admin of the battalion. */
export const roleOf = (user: Profile): string =>
  user.role === "admin" ? t.roleLabels.admin : user.super_user ? t.superUser : t.soldier;

export function UserFields({ user, units }: { user: Profile; units: Unit[] }) {
  return (
    <dl className="facts">
      <dt>{t.serviceNumber}</dt><dd><bdi dir="ltr">{user.service_number}</bdi></dd>
      <dt>{t.emailLabel}</dt><dd><bdi dir="ltr">{user.email}</bdi></dd>
      <dt>{t.role}</dt><dd>{roleOf(user)}</dd>
      {user.role !== "admin" && <><dt>{t.unitOf[unitKindOf(user.role)]}</dt><dd>{unitNamesOf(user, units)}</dd></>}
    </dl>
  );
}
