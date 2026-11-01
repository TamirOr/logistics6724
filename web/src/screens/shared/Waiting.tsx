import { useSession } from "../../lib/session";
import { PushPrompt } from "./PushPrompt";
import { UpdateBanner } from "../../components/UpdateBanner";
import { t } from "../../strings";

/** "ממתין לאישור" after sign-up, and the screen for deactivated users. */
export function Waiting() {
  const { profile, signOut } = useSession();
  const deactivated = profile?.active === false;
  return (
    <div className="page center">
      <UpdateBanner />
      <main className="content narrow stack">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="logo" />
        <h1>{deactivated ? t.deactivatedTitle : t.waitingTitle}</h1>
        <p>{deactivated ? t.deactivatedBody : t.waitingBody}</p>
        {!deactivated && <PushPrompt />}
        <button className="btn btn-ghost" onClick={signOut}>{t.signOut}</button>
      </main>
    </div>
  );
}
