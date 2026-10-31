// An admin creates a customer or supplier from their email and sign-up
// details. The server approves them: they sign in with a code and land in
// the app, with no join code and no wait.
import { useState, type FormEvent } from "react";
import { ProfileInputs } from "../../components/ProfileInputs";
import { EMPTY_DRAFT } from "../../lib/profileDraft";
import { Sheet } from "../../components/Sheet";
import { createUser } from "../../lib/api";
import { describeError } from "../../lib/errors";
import type { ProfileDraft, Unit } from "../../lib/types";
import { t } from "../../strings";

interface NewUserSheetProps {
  units: Unit[];
  onClose: () => void;
  /** After the server created the user: the message to show. */
  onCreated: (message: string) => void;
}

export function NewUserSheet({ units, onClose, onCreated }: NewUserSheetProps) {
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.unitIds.length === 0) return setError(t.pickAtLeastOneUnit);
    setBusy(true);
    setError(null);
    try {
      const outcome = await createUser(email.trim(), draft);
      const name = `${draft.firstName.trim()} ${draft.lastName.trim()}`;
      onCreated(outcome === "created" ? t.userCreated(name) : t.userInvited(name));
    } catch (error) {
      setError(describeError(error));
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.newUser} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">{t.newUserHint}</p>
        <label className="field"><span>{t.emailLabel}</span>
          <input className="input" type="email" dir="ltr" autoComplete="off" required maxLength={254} value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        <ProfileInputs draft={draft} units={units.filter((u) => u.active)} onChange={setDraft} />
        <button className="btn btn-primary btn-block" disabled={busy}>{t.createUser}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
