// Users waiting for approval, each with approve and reject (with an
// optional reason). Admins see every sign-up; a super user sees those still
// waiting in their units, and acts for those units only. The server decides
// which rows come back and what each action does.
import { useState } from "react";
import { approveUser, rejectUser } from "../lib/api";
import type { Profile, Unit } from "../lib/types";
import { Sheet } from "./Sheet";
import { UserFields } from "./UserFields";
import { t } from "../strings";

interface Props {
  pending: Profile[];
  units: Unit[];
  act: (action: () => Promise<void>) => void;
}

export function PendingSignups({ pending, units, act }: Props) {
  const [rejecting, setRejecting] = useState<Profile | null>(null);
  const [reason, setReason] = useState("");

  return (
    <>
      <h2 className="section-title">{t.pendingSignups}</h2>
      {pending.length === 0 && <p className="muted">{t.noPendingSignups}</p>}
      {pending.map((u) => (
        <article key={u.id} className="card signup">
          <div className="signup-name" dir="auto">{u.first_name} {u.last_name}</div>
          <UserFields user={u} units={units} />
          <div className="row">
            <button className="btn btn-success" onClick={() => act(() => approveUser(u.id))}>{t.approve}</button>
            <button className="btn btn-danger" onClick={() => { setRejecting(u); setReason(""); }}>{t.reject}</button>
          </div>
        </article>
      ))}

      {rejecting && (
        <Sheet title={`${t.reject}: ${rejecting.first_name} ${rejecting.last_name}`} onClose={() => setRejecting(null)}>
          <div className="stack">
            <input className="input" dir="auto" placeholder={t.rejectReason} value={reason}
              onChange={(e) => setReason(e.target.value)} />
            <button className="btn btn-danger btn-block"
              onClick={() => { act(() => rejectUser(rejecting.id, reason)); setRejecting(null); }}>{t.reject}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
