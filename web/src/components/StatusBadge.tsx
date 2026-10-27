import { STATUS_LABELS, t } from "../strings";
import type { ListOverview, ListStatus, RequestStatus } from "../lib/types";

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function ListStatusBadge({ status }: { status: ListStatus }) {
  return <span className={`badge badge-list-${status}`}>{t.listStatus[status]}</span>;
}

const COUNTED = ["pending", "ready", "partial", "missing", "collected"] as const;

/** "ממתין 3 · מוכן לאיסוף 2": the non-zero request counts of a list. */
export function StatusCounts({ list }: { list: ListOverview }) {
  return (
    <>
      {COUNTED.filter((s) => list[`n_${s}`] > 0).map((s) => (
        <span key={s} className={`count count-${s}`}>{STATUS_LABELS[s]} {list[`n_${s}`]}</span>
      ))}
    </>
  );
}
