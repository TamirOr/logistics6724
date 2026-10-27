// The admin home's status line: green when every health check passes, red
// with the failing checks named. Same report the health workflow checks.
import { useEffect, useState } from "react";
import { fetchAdminHealth } from "../../lib/api";
import type { HealthReport } from "../../lib/types";
import { t } from "../../strings";

export function HealthStrip() {
  const [report, setReport] = useState<HealthReport | null>(null);
  useEffect(() => {
    fetchAdminHealth().then(setReport).catch(() => {}); // Offline: show nothing rather than a stale verdict.
  }, []);
  if (!report) return null;

  const failing = report.checks.filter((c) => !c.ok);
  const p95 = report.metrics.push_p95_seconds;
  return (
    <div className={`health ${report.ok ? "health-ok" : "health-bad"}`} role="status">
      {report.ok ? <span>{t.systemOk}</span> : <span>{t.systemProblem}</span>}
      {failing.map((c) => <span key={c.name}>{t.healthChecks[c.name] ?? c.name}</span>)}
      {typeof p95 === "number" && <span className="small">{t.pushP95(Math.round(p95))}</span>}
    </div>
  );
}
