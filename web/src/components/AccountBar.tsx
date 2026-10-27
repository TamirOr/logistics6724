// Sign-out, in the header of the top-level screens.
import { useQueue } from "../lib/queue";
import { useSession } from "../lib/session";
import { t } from "../strings";

export function AccountBar() {
  const { signOut } = useSession();
  const queue = useQueue();

  // Signing out drops changes not yet sent to the server, so only then ask.
  const confirmAndSignOut = () => {
    if (queue.length && !window.confirm(t.signOutUnsynced(queue.length))) return;
    signOut();
  };

  return <button className="btn btn-ghost btn-small" onClick={confirmAndSignOut}>{t.signOut}</button>;
}
