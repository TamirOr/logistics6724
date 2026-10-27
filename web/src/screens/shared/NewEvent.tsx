// Opens a new event, or duplicates one: same items and quantities, every
// status pending, with a new name and time.
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { createEvent, duplicateEvent, fetchEvent } from "../../lib/api";
import { useProfile } from "../../lib/session";
import type { EventScope, LogisticsEvent } from "../../lib/types";
import { formatEventDate } from "../../../../supabase/functions/_shared/dates.ts";
import { describeError } from "../../lib/errors";
import { todayIso } from "../../lib/time";
import { t } from "../../strings";

export function NewEvent() {
  const { id: sourceId } = useParams();
  const profile = useProfile();
  const navigate = useNavigate();
  const isAdmin = profile.role === "admin";
  const [source, setSource] = useState<LogisticsEvent | null>(null);
  const [name, setName] = useState("");
  const [neededOn, setNeededOn] = useState(todayIso);
  const [neededBy, setNeededBy] = useState("");
  const [scope, setScope] = useState<EventScope>(isAdmin ? "battalion" : "company");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    fetchEvent(sourceId).then((e) => {
      if (!e) return;
      setSource(e);
      setName(e.name);
      setNeededBy(e.needed_by?.slice(0, 5) ?? "");
      setScope(e.scope);
    });
  }, [sourceId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = source
        ? await duplicateEvent(source.id, name.trim(), { neededOn, neededBy })
        : await createEvent(name.trim(), scope, { neededOn, neededBy });
      navigate(`/events/${id}`, { replace: true });
    } catch (error) {
      setError(describeError(error));
      setBusy(false);
    }
  };

  return (
    <Layout title={source ? t.duplicate : t.newEvent} back>
      <form className="stack narrow" onSubmit={submit}>
        <label className="field"><span>{t.eventName}</span>
          <input className="input" dir="auto" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row when">
          <label className="field"><span>{t.eventDate}</span>
            <input className="input" type="date" dir="ltr" required min={todayIso()} value={neededOn}
              onChange={(e) => setNeededOn(e.target.value)} />
            <small className="muted">{neededOn && formatEventDate(neededOn)}</small>
          </label>
          <label className="field"><span>{t.eventTime}</span>
            <input className="input" type="time" dir="ltr" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </label>
        </div>
        {!source && !isAdmin && (
          <fieldset className="field">
            <legend>{t.scope}</legend>
            <div className="segmented">
              {(["company", "battalion"] as const).map((s) => (
                <button type="button" key={s} className={scope === s ? "active" : ""} onClick={() => setScope(s)}>
                  {s === "company" ? t.scopeCompany : t.scopeBattalion}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {source ? t.duplicate : t.create}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </Layout>
  );
}
