// First sign-in: the battalion's join code, then name, service number,
// side and unit. A supplier may pick several supplier units. Also shown
// again after a rejection, with the reason. Units are listed only for a
// correct join code: anyone with an email can sign in, and the roster is
// not for strangers.
import { useState, type FormEvent } from "react";
import { fetchSignupUnits, registerProfile } from "../../lib/api";
import { useSession } from "../../lib/session";
import type { Unit, UserRole } from "../../lib/types";
import { unitKindOf, unitsOf } from "../../lib/userUnits";
import { describeError } from "../../lib/errors";
import { t } from "../../strings";

export function Onboarding() {
  const { profile, reloadProfile, signOut } = useSession();
  const [joinCode, setJoinCode] = useState("");
  const [units, setUnits] = useState<Pick<Unit, "id" | "name" | "kind">[] | null>(null);
  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [serviceNumber, setServiceNumber] = useState(profile?.service_number ?? "");
  const [role, setRole] = useState<UserRole>(profile?.role === "supplier" ? "supplier" : "customer");
  // The first picked is the main unit.
  const [unitIds, setUnitIds] = useState<string[]>(profile ? unitsOf(profile) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = (units ?? []).filter((u) => u.kind === unitKindOf(role));

  const submitJoinCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setUnits(await fetchSignupUnits(joinCode));
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleUnit = (id: string, on: boolean) =>
    setUnitIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (unitIds.length === 0) return setError(t.pickAtLeastOneUnit);
    setBusy(true);
    setError(null);
    try {
      await registerProfile({ firstName, lastName, serviceNumber, role, unitIds });
      await reloadProfile();
    } catch (error) {
      setError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="header"><h1 className="header-title">{t.profileTitle}</h1></header>
      <main className="content narrow">
        {profile?.approval === "rejected" && (
          <div className="notice notice-error">
            <strong>{t.rejectedTitle}</strong>
            {profile.rejection_reason && <p dir="auto">{t.rejectedReason(profile.rejection_reason)}</p>}
          </div>
        )}
        {units === null ? (
          <form className="stack" onSubmit={submitJoinCode}>
            <label className="field"><span>{t.joinCode}</span>
              <input className="input" dir="ltr" inputMode="numeric" autoComplete="off" pattern="[0-9]{10}"
                maxLength={10} title={t.joinCodeHint} required autoFocus value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))} />
            </label>
            <p className="muted">{t.joinCodeHint}</p>
            <button className="btn btn-primary btn-block" disabled={busy || joinCode.length !== 10}>
              {t.joinCodeContinue}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        ) : (
          <form className="stack" onSubmit={submit}>
            <label className="field"><span>{t.firstName}</span>
              <input className="input" dir="auto" required maxLength={50} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
            <label className="field"><span>{t.lastName}</span>
              <input className="input" dir="auto" required maxLength={50} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
            <label className="field"><span>{t.serviceNumber}</span>
              <input className="input" dir="ltr" inputMode="numeric" pattern="[0-9]{5,9}" title={t.serviceNumberHint}
                required value={serviceNumber} onChange={(e) => setServiceNumber(e.target.value.replace(/\D/g, ""))} />
            </label>
            <fieldset className="field">
              <legend>{t.side}</legend>
              <div className="segmented">
                {(["customer", "supplier"] as const).map((r) => (
                  <button type="button" key={r} className={role === r ? "active" : ""}
                    onClick={() => { setRole(r); setUnitIds([]); }}>
                    {r === "customer" ? t.sideCustomer : t.sideSupplier}
                  </button>
                ))}
              </div>
            </fieldset>
            {role === "customer" ? (
              <label className="field"><span>{t.unitOf.company}</span>
                <select className="input" required value={unitIds[0] ?? ""} onChange={(e) => setUnitIds([e.target.value])}>
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
                    <input type="checkbox" checked={unitIds.includes(u.id)} onChange={(e) => toggleUnit(u.id, e.target.checked)} />
                    {u.name}
                  </label>
                ))}
              </fieldset>
            )}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {profile?.approval === "rejected" ? t.reapply : t.submit}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        )}
        <button className="btn btn-ghost" onClick={signOut}>{t.signOut}</button>
      </main>
    </div>
  );
}
