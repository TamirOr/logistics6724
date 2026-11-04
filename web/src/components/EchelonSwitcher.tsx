// Front or rear echelon, on a company user's home screen. Users switch
// whenever they like; the home screen of the other echelon opens.
import { useNavigate } from "react-router-dom";
import { setEchelon } from "../lib/api";
import { echelonOf } from "../lib/echelon";
import { useSession } from "../lib/session";
import type { Echelon } from "../lib/types";
import { useAction } from "./Toast";
import { t } from "../strings";

const ECHELONS: Echelon[] = ["front", "rear"];

export function EchelonSwitcher() {
  const { profile, reloadProfile } = useSession();
  const runAction = useAction();
  const navigate = useNavigate();
  if (!profile) return null;
  const current = echelonOf(profile);

  const pick = (echelon: Echelon) => {
    if (echelon === current) return;
    runAction(async () => {
      await setEchelon(profile.id, echelon);
      await reloadProfile();
    }, () => navigate("/", { replace: true }));
  };

  return (
    <div className="segmented" role="group" aria-label={t.echelon}>
      {ECHELONS.map((e) => (
        <button key={e} className={e === current ? "active" : ""} aria-pressed={e === current}
          onClick={() => pick(e)}>{t.echelonLabels[e]}</button>
      ))}
    </div>
  );
}
