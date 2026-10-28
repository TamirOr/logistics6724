// Shown instead of the app when a screen throws. The error is already on
// its way to Sentry; reloading starts from a clean state, and queued writes
// survive it in localStorage.
import { t } from "../strings";

export function Crash() {
  return (
    <div className="page center" role="alert">
      <main className="content narrow stack">
        <h1>{t.crashTitle}</h1>
        <p>{t.crashBody}</p>
        <button className="btn btn-primary btn-big" onClick={() => location.reload()}>{t.reload}</button>
      </main>
    </div>
  );
}
