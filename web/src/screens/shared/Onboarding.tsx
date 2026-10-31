// First sign-in: the battalion's join code, then the sign-up details
// (components/ProfileInputs). Also shown again after a rejection, with the
// reason. Units are listed only for a correct join code: anyone with an
// email can sign in, and the roster is not for strangers.
import { useState, type FormEvent } from "react";
import { fetchSignupUnits, registerProfile } from "../../lib/api";
import { useSession } from "../../lib/session";
import { ProfileInputs } from "../../components/ProfileInputs";
import { EMPTY_DRAFT } from "../../lib/profileDraft";
import type { ProfileDraft, Unit } from "../../lib/types";
import { unitsOf } from "../../lib/userUnits";
import { describeError } from "../../lib/errors";
import { t } from "../../strings";

export function Onboarding() {
  const { profile, reloadProfile, signOut } = useSession();
  const [joinCode, setJoinCode] = useState("");
  const [units, setUnits] = useState<Pick<Unit, "id" | "name" | "kind">[] | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(profile ? {
    firstName: profile.first_name, lastName: profile.last_name, serviceNumber: profile.service_number,
    role: profile.role === "supplier" ? "supplier" : "customer", unitIds: unitsOf(profile),
  } : EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.unitIds.length === 0) return setError(t.pickAtLeastOneUnit);
    setBusy(true);
    setError(null);
    try {
      await registerProfile(draft);
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
            <ProfileInputs draft={draft} units={units} onChange={setDraft} />
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
