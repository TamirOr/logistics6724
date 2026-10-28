// Diagnostics and sign-out, in the header of the top-level screens, and the
// way back to admin for an admin working as a unit's user.
import { Link } from "react-router-dom";
import { useWorkAs } from "../hooks/useWorkAs";
import { useQueue } from "../lib/queue";
import { useSession } from "../lib/session";
import { t } from "../strings";

export function AccountBar() {
  const { signOut, adminInUnit } = useSession();
  const queue = useQueue();
  const workAs = useWorkAs();

  // Signing out drops changes not yet sent to the server, so only then ask.
  const confirmAndSignOut = () => {
    if (queue.length && !window.confirm(t.signOutUnsynced(queue.length))) return;
    signOut();
  };

  return (
    <>
      {adminInUnit && <button className="btn btn-primary btn-small" onClick={() => workAs(null)}>{t.returnToAdmin}</button>}
      <Link className="btn btn-ghost btn-small" to="/diagnostics">{t.diagnostics}</Link>
      <button className="btn btn-ghost btn-small" onClick={confirmAndSignOut}>{t.signOut}</button>
    </>
  );
}
