// Which of the user's supplier units the screen shows. Only for a supplier
// in more than one.
import { setActiveSupplier, useActiveSupplier } from "../lib/activeSupplier";
import { useUnits } from "../lib/live";
import { useProfile } from "../lib/session";
import { t } from "../strings";

export function SupplierSwitcher() {
  const profile = useProfile();
  const active = useActiveSupplier();
  const mine = useUnits().filter((u) => profile.supplier_ids?.includes(u.id));
  if (mine.length < 2) return null;

  return (
    <div className="segmented" role="group" aria-label={t.supplierUnit}>
      {mine.map((u) => (
        <button key={u.id} className={u.id === active ? "active" : ""} aria-pressed={u.id === active}
          onClick={() => setActiveSupplier(u.id)}>{u.name}</button>
      ))}
    </div>
  );
}
