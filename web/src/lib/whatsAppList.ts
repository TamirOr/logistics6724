// "העתקה לוואטסאפ": the company's list as one message to paste in a group,
// by category, optionally under a title per supplier.
import { groupByCategory, hasCategories } from "./categories";
import type { Item, Request } from "./types";
import { t } from "../strings";

export interface WhatsAppListInput {
  eventName: string;
  companyName: string;
  /** The list's requests; cancelled ones are left out. */
  rows: Request[];
  /** Suppliers in the order the screen shows them. */
  suppliers: { id: string; name: string }[];
  itemOf: (itemId: string) => Item | undefined;
  /** Under a title per supplier, or one list by category only. */
  bySupplier: boolean;
}

export function whatsAppList(input: WhatsAppListInput): string {
  const listed = input.rows
    .filter((r) => r.status !== "cancelled" && input.itemOf(r.item_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const blocks = input.bySupplier
    ? input.suppliers.flatMap((s) => {
      const rows = listed.filter((r) => r.supplier_id === s.id);
      return rows.length ? [`*${s.name}*\n${categoryBlocks(rows, input.itemOf)}`] : [];
    })
    : listed.length ? [categoryBlocks(listed, input.itemOf)] : [];
  return [`${t.whatsAppTitle} – ${input.eventName} | ${input.companyName}`, ...blocks].join("\n\n");
}

function categoryBlocks(rows: Request[], itemOf: WhatsAppListInput["itemOf"]): string {
  const groups = groupByCategory(rows, (r) => itemOf(r.item_id)?.category);
  const bullets = (group: Request[]) => group.map((r) => itemLine(r, itemOf(r.item_id)!)).join("\n");
  if (!hasCategories(groups)) return bullets(rows);
  return groups.map((g) => `${g.category ?? t.generalCategory}:\n${bullets(g.rows)}`).join("\n\n");
}

/** "• אורז – 2 שקים (בסמטי)" */
export function itemLine(r: Request, item: Item): string {
  const quantity = [r.quantity, r.measure].filter(Boolean).join(" ");
  const note = r.customer_note?.trim();
  return `• ${item.name} – ${quantity}${note ? ` (${note})` : ""}`;
}
