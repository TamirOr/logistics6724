// The server needs a newer build (min_client_version). Writes wait on the
// phone until the reload brings it.
import { reloadToLatest } from "../../lib/appUpdate";
import { t } from "../../strings";

export function Outdated() {
  return (
    <div className="page center" role="alert">
      <main className="content narrow stack">
        <h1>{t.outdatedTitle}</h1>
        <p>{t.outdatedBody}</p>
        <button className="btn btn-primary btn-big" onClick={reloadToLatest}>{t.update}</button>
      </main>
    </div>
  );
}
