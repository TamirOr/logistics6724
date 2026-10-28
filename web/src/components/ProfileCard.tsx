// The signed-in user's own details: name and the unit they work in now,
// with the rest of their profile one tap away.
import type { Profile, Unit } from "../lib/types";
import { UserFields } from "./UserFields";
import { t } from "../strings";

interface Props {
  profile: Profile;
  units: Unit[];
  /** The unit the screen shows, for a supplier in several. */
  activeUnitId: string;
}

export function ProfileCard({ profile, units, activeUnitId }: Props) {
  const activeUnit = units.find((u) => u.id === activeUnitId)?.name;
  return (
    <details className="card profile-card">
      <summary>
        <bdi dir="auto" className="profile-name">{profile.first_name} {profile.last_name}</bdi>
        {activeUnit && <span className="muted"> · {activeUnit}</span>}
      </summary>
      <h2 className="section-title">{t.profile}</h2>
      <UserFields user={profile} units={units} />
    </details>
  );
}
