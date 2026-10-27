// On iPhone outside the installed app: the add-to-home-screen guide.
// Elsewhere: a button that asks for notification permission.
import { useState } from "react";
import { enablePush, needsInstallForPush, pushSupported } from "../../lib/push";
import { useSession } from "../../lib/session";
import { t } from "../../strings";

const DISMISS_KEY = "install-guide-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function PushPrompt() {
  const { session } = useSession();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [permission, setPermission] = useState(pushSupported() ? Notification.permission : "denied");

  if (needsInstallForPush()) {
    if (dismissed) return null;
    const dismiss = () => {
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
      setDismissed(true);
    };
    return (
      <section className="card install-guide">
        <h2>{t.installTitle}</h2>
        <p className="muted">{t.installWhy}</p>
        <ol>
          {t.installSteps.map((step, i) => (
            <li key={step}>
              <span className="step-icon" aria-hidden>{["⬆️", "➕", "📱"][i]}</span>
              {step}
            </li>
          ))}
        </ol>
        <button className="btn btn-ghost" onClick={dismiss}>{t.installLater}</button>
      </section>
    );
  }

  if (!pushSupported() || permission === "granted" || !session) return null;
  if (permission === "denied") return <p className="muted">{t.notificationsBlocked}</p>;
  return (
    <button className="btn btn-secondary btn-block"
      onClick={async () => setPermission(await enablePush(session.user.id))}>
      🔔 {t.enableNotifications}
    </button>
  );
}
