// Email one-time code. A code rather than a magic link, because a link
// opens in Safari and would not sign in the installed iPhone app.
import { useState, type FormEvent } from "react";
import { sendCode, verifyCode } from "../../lib/api";
import { t } from "../../strings";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await sendCode(email.trim());
    setBusy(false);
    if (error) setError(t.genericError);
    else setStep("code");
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await verifyCode(email.trim(), code.trim());
    setBusy(false);
    if (error) setError(t.invalidCode);
    // On success the session provider moves the app on.
  };

  return (
    <div className="page center">
      <main className="content narrow">
        <img src="/icon.svg" alt="" className="logo" />
        <h1>{t.appName}</h1>
        {step === "email" ? (
          <form className="stack" onSubmit={requestCode}>
            <label className="field">
              <span>{t.emailLabel}</span>
              <input className="input" type="email" dir="ltr" autoComplete="email" inputMode="email"
                required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy}>{t.sendCode}</button>
          </form>
        ) : (
          <form className="stack" onSubmit={submitCode}>
            <p dir="auto">{t.codeSentTo(email)}</p>
            <label className="field">
              <span>{t.codeLabel}</span>
              <input className="input code-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
                pattern="[0-9]{6}" maxLength={6} required autoFocus value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>{t.verify}</button>
            <div className="row">
              <button type="button" className="btn btn-ghost" onClick={() => setStep("email")}>{t.changeEmail}</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => requestCode()}>{t.resendCode}</button>
            </div>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
