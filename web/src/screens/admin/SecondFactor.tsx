// Admins confirm sign-in with an authenticator app (TOTP). The first time,
// they scan a QR code to set the app up; after that they type its code.
import { useEffect, useState, type FormEvent } from "react";
import { startSecondFactor, verifySecondFactor, type SecondFactorStart } from "../../lib/mfa";
import { describeError } from "../../lib/errors";
import { useSession } from "../../lib/session";
import { t } from "../../strings";

export function SecondFactor() {
  const { reloadProfile, signOut } = useSession();
  const [start, setStart] = useState<SecondFactorStart | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startSecondFactor().then(setStart).catch((e) => setError(describeError(e)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      await verifySecondFactor(start.factorId, code);
      await reloadProfile();
    } catch {
      setError(t.mfaInvalidCode);
      setBusy(false);
    }
  };

  return (
    <div className="page center">
      <main className="content narrow">
        <h1>{t.mfaTitle}</h1>
        {start?.step === "enroll" && (
          <div className="stack">
            <p>{t.mfaEnrollHint}</p>
            <img className="qr" src={start.qrSrc} alt={t.mfaQrAlt} />
            <p className="muted">{t.mfaSecretLabel}</p>
            <code dir="ltr" className="secret">{start.secret}</code>
          </div>
        )}
        {start?.step === "verify" && <p>{t.mfaVerifyHint}</p>}
        {start && (
          <form className="stack" onSubmit={submit}>
            <label className="field">
              <span>{t.mfaCodeLabel}</span>
              <input className="input code-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" maxLength={6} required autoFocus value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>{t.verify}</button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-ghost" onClick={signOut}>{t.signOut}</button>
      </main>
    </div>
  );
}
