// The sign-up details: name, service number, side and unit. A supplier may
// pick several supplier units. Used by sign-up and by admins creating a user.
import { withSide, withUnit } from "../lib/profileDraft";
import type { ProfileDraft, Unit } from "../lib/types";
import { unitKindOf } from "../lib/userUnits";
import { t } from "../strings";

interface ProfileInputsProps {
  draft: ProfileDraft;
  /** The units to pick from, of both kinds. */
  units: Pick<Unit, "id" | "name" | "kind">[];
  onChange: (draft: ProfileDraft) => void;
}

export function ProfileInputs({ draft, units, onChange }: ProfileInputsProps) {
  const set = (patch: Partial<ProfileDraft>) => onChange({ ...draft, ...patch });
  const options = units.filter((u) => u.kind === unitKindOf(draft.role));

  return (
    <>
      <label className="field"><span>{t.firstName}</span>
        <input className="input" dir="auto" required maxLength={50} value={draft.firstName}
          onChange={(e) => set({ firstName: e.target.value })} />
      </label>
      <label className="field"><span>{t.lastName}</span>
        <input className="input" dir="auto" required maxLength={50} value={draft.lastName}
          onChange={(e) => set({ lastName: e.target.value })} />
      </label>
      <label className="field"><span>{t.serviceNumber}</span>
        <input className="input" dir="ltr" inputMode="numeric" pattern="[0-9]{5,9}" title={t.serviceNumberHint}
          required value={draft.serviceNumber} onChange={(e) => set({ serviceNumber: e.target.value.replace(/\D/g, "") })} />
      </label>
      <fieldset className="field">
        <legend>{t.side}</legend>
        <div className="segmented">
          {(["customer", "supplier"] as const).map((r) => (
            <button type="button" key={r} className={draft.role === r ? "active" : ""} aria-pressed={draft.role === r}
              onClick={() => onChange(withSide(draft, r))}>
              {r === "customer" ? t.sideCustomer : t.sideSupplier}
            </button>
          ))}
        </div>
      </fieldset>
      {draft.role === "customer" ? (
        <label className="field"><span>{t.unitOf.company}</span>
          <select className="input" required value={draft.unitIds[0] ?? ""} onChange={(e) => set({ unitIds: [e.target.value] })}>
            <option value="" disabled>{t.pickUnit}</option>
            {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      ) : (
        <fieldset className="field">
          <legend>{t.supplierUnits}</legend>
          <p className="muted">{t.supplierUnitsHint}</p>
          {options.map((u) => (
            <label key={u.id} className="switch">
              <input type="checkbox" checked={draft.unitIds.includes(u.id)} onChange={(e) => onChange(withUnit(draft, u.id, e.target.checked))} />
              {u.name}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
