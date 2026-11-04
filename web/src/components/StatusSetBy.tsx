// Who set a request's status last and when, quietly at the bottom of its
// sheet, for when it is unclear who marked what.
import { writerLabel } from "../lib/echelon";
import { useUnits } from "../lib/live";
import { formatWrittenAt } from "../lib/time";
import type { Request } from "../lib/types";
import { t } from "../strings";

export function StatusSetBy({ request: r }: { request: Request }) {
  const units = useUnits();
  if (!r.status_set_at || !r.status_set_by_unit) return null;
  const unitName = units.find((u) => u.id === r.status_set_by_unit)?.name ?? "";
  return <p className="muted small">{t.statusSetBy(writerLabel(unitName, r.status_set_by_echelon), formatWrittenAt(r.status_set_at))}</p>;
}
