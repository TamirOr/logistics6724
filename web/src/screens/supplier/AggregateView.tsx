// One row per item and measure with the total across companies; tap for
// the split. "5 קרטון" and "20 ליטר" of one item do not add up, so each
// measure gets its own row. Rows are grouped by the item's category.
import { useState } from "react";
import { CategorizedList } from "../../components/CategorizedList";
import { RequestQuantity } from "../../components/RequestQuantity";
import type { Item, Request, Unit } from "../../lib/types";
import { t } from "../../strings";

interface ItemTotal {
  key: string;
  item_name: string;
  category: string | null;
  supplier_name: string;
  quantity: number;
  measure: string | null;
  byCompany: { company: string; quantity: number }[];
}

/** Totals of requests still to prepare. Cancelled requests are left out. */
export function aggregateTotals(requests: Request[], itemOf: (id: string) => Item | undefined, units: Unit[]): ItemTotal[] {
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "";
  const totals = new Map<string, ItemTotal>();
  for (const r of requests) {
    if (r.status === "cancelled") continue;
    const key = `${r.item_id}:${r.measure ?? ""}`;
    const item = itemOf(r.item_id);
    const total = totals.get(key) ?? {
      key, item_name: item?.name ?? "", category: item?.category ?? null, supplier_name: unitName(r.supplier_id),
      quantity: 0, measure: r.measure, byCompany: [],
    };
    total.quantity += r.quantity;
    const company = unitName(r.company_id);
    const split = total.byCompany.find((c) => c.company === company);
    if (split) split.quantity += r.quantity;
    else total.byCompany.push({ company, quantity: r.quantity });
    totals.set(key, total);
  }
  return [...totals.values()].sort((a, b) =>
    a.item_name.localeCompare(b.item_name, "he") || (a.measure ?? "").localeCompare(b.measure ?? "", "he"));
}

interface Props {
  requests: Request[];
  itemOf: (id: string) => Item | undefined;
  units: Unit[];
}

export function AggregateView({ requests, itemOf, units }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <CategorizedList className="req-list aggregate" rows={aggregateTotals(requests, itemOf, units)}
      categoryOf={(total) => total.category} renderRow={(total) => (
        <li key={total.key} className="req">
          <button className="req-main" aria-expanded={expanded === total.key}
            onClick={() => setExpanded(expanded === total.key ? null : total.key)}>
            <RequestQuantity quantity={total.quantity} measure={total.measure} />
            <span className="req-name user-text" dir="auto">{total.item_name}</span>
            <span className="muted">{t.companiesCount(total.byCompany.length)}</span>
          </button>
          {expanded === total.key && (
            <ul className="split">
              {total.byCompany.map((c) => (
                <li key={c.company}><span className="req-qty">{c.quantity}</span> {c.company}</li>
              ))}
            </ul>
          )}
        </li>
      )} />
  );
}
