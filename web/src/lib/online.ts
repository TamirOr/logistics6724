/**
 * Runs load now and, if it fails (typically with no signal), again each
 * time the browser comes back online, until it succeeds. Returns a stop
 * function for unmount. The failure is expected offline, so it is not
 * left as an unhandled rejection for Sentry to report.
 */
export function loadWhenOnline(load: () => Promise<unknown>): () => void {
  const stop = () => window.removeEventListener("online", attempt);
  const attempt = () => {
    load().then(stop, () => {});
  };
  window.addEventListener("online", attempt);
  attempt();
  return stop;
}
