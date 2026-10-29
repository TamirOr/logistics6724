// The category and status pickers above a request list. The category picker
// shows only when the list has categories. Renders bare selects, so the
// screen places them in its own toolbar.
import { GENERAL_CATEGORY, type RequestFilter } from "../lib/requestFilter";
import type { RequestStatus } from "../lib/types";
import { STATUS_LABELS, t } from "../strings";

interface Props {
  filter: RequestFilter;
  onChange: (filter: RequestFilter) => void;
  /** From categoryOptions. */
  categories: string[];
  statuses: RequestStatus[];
}

export function RequestFilters({ filter, onChange, categories, statuses }: Props) {
  return (
    <>
      {categories.length > 0 && (
        <select className="input" aria-label={t.filterByCategory} value={filter.category}
          onChange={(e) => onChange({ ...filter, category: e.target.value })}>
          <option value="">{t.allCategories}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c === GENERAL_CATEGORY ? t.generalCategory : c}</option>
          ))}
        </select>
      )}
      <select className="input" aria-label={t.filterByStatus} value={filter.status}
        onChange={(e) => onChange({ ...filter, status: e.target.value as RequestStatus | "" })}>
        <option value="">{t.allStatuses}</option>
        {statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </select>
    </>
  );
}
