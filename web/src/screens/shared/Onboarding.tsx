// First sign-in: name, service number, side and unit. Also shown again
// after a rejection, with the reason.
import { useState, type FormEvent } from "react";
import { registerProfile } from "../../lib/api";
import { useUnits } from "../../lib/live";
import { useSession } from "../../lib/session";
import type { UserRole } from "../../lib/types";
import { describeError } from "../../lib/errors";
import { t } from "../../strings";

export function Onboarding() {
  const { profile, reloadProfile, signOut } = useSession();
  const units = useUnits();
  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [serviceNumber, setServiceNumber] = useState(profile?.service_number ?? "");
  const [role, setRole] = useState<UserRole>(profile?.role === "supplier" ? "supplier" : "customer");
  const [unitId, setUnitId] = useState(profile?.unit_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = role === "customer" ? "company" : "supplier";
  const options = units.filter((u) => u.kind === kind && u.active);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerProfile({ firstName, lastName, serviceNumber, role, unitId });
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
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>{t.firstName}</span>
            <input className="input" dir="auto" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="field"><span>{t.lastName}</span>
            <input className="input" dir="auto" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
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
                  onClick={() => { setRole(r); setUnitId(""); }}>
                  {r === "customer" ? t.sideCustomer : t.sideSupplier}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field"><span>{t.unit}</span>
            <select className="input" required value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="" disabled>{t.pickUnit}</option>
              {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {profile?.approval === "rejected" ? t.reapply : t.submit}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
        <button className="btn btn-ghost" onClick={signOut}>{t.signOut}</button>
      </main>
    </div>
  );
}
