// One row per item with the total across companies; tap for the split.
import { useState } from "react";
import type { Item, Request, Unit } from "../../lib/types";
import { t } from "../../strings";

interface ItemTotal {
  itemId: string;
  item_name: string;
  supplier_name: string;
  quantity: number;
  byCompany: { company: string; quantity: number }[];
}

/** Totals of requests still to prepare. Cancelled requests are left out. */
export function aggregateTotals(requests: Request[], itemOf: (id: string) => Item | undefined, units: Unit[]): ItemTotal[] {
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "";
  const totals = new Map<string, ItemTotal>();
  for (const r of requests) {
    if (r.status === "cancelled") continue;
    const total = totals.get(r.item_id) ?? {
      itemId: r.item_id, item_name: itemOf(r.item_id)?.name ?? "", supplier_name: unitName(r.supplier_id),
      quantity: 0, byCompany: [],
    };
    total.quantity += r.quantity;
    const company = unitName(r.company_id);
    const split = total.byCompany.find((c) => c.company === company);
    if (split) split.quantity += r.quantity;
    else total.byCompany.push({ company, quantity: r.quantity });
    totals.set(r.item_id, total);
  }
  return [...totals.values()].sort((a, b) => a.item_name.localeCompare(b.item_name, "he"));
}

interface Props {
  requests: Request[];
  itemOf: (id: string) => Item | undefined;
  units: Unit[];
}

export function AggregateView({ requests, itemOf, units }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ul className="req-list aggregate">
      {aggregateTotals(requests, itemOf, units).map((total) => (
        <li key={total.itemId} className="req">
          <button className="req-main" aria-expanded={expanded === total.itemId}
            onClick={() => setExpanded(expanded === total.itemId ? null : total.itemId)}>
            <span className="req-qty">{total.quantity}</span>
            <span className="req-name user-text" dir="auto">{total.item_name}</span>
            <span className="muted">{t.companiesCount(total.byCompany.length)}</span>
          </button>
          {expanded === total.itemId && (
            <ul className="split">
              {total.byCompany.map((c) => (
                <li key={c.company}><span className="req-qty">{c.quantity}</span> {c.company}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
