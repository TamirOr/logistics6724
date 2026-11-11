// "ייבוא מוואטסאפ": reads a list pasted from a WhatsApp message into lines a
// company can add as requests. It reads the format "העתקה לוואטסאפ" writes,
// and the looser lists people type by hand:
//
//   🥒 ירקות:                  a category title (a line before bullets)
//   • מלפפון – 3               name – quantity
//   • אורז – *20* שקים         WhatsApp bold is ignored; a word after the quantity is its measure
//   • שום טרי (אם אין, כתוש)   no quantity; parentheses are a note
//   * 25 סוללות aaa            a quantity before the name
//   *מזון*                     a supplier's title, when it is a supplier's name
import type { ItemMatch } from "./api";
import { MEASURE_MAX_LENGTH } from "./requests";
import type { Request } from "./types";

export interface ImportedLine {
  name: string;
  /** null: the message gave none. */
  quantity: number | null;
  measure: string | null;
  note: string | null;
  /** The title the line sat under, for a new item. */
  category: string | null;
  /** The supplier whose title the line sat under. */
  supplierId: string | null;
}

interface Supplier { id: string; name: string }

const BULLET = /^[•·◦▪\-–—*]\s+/;
const SEPARATOR = /\s+[-–—]\s+/;
const WHATSAPP_MARKUP = /[*_~]/g;

export function parseWhatsAppList(text: string, suppliers: Supplier[]): ImportedLine[] {
  const rows = text.split(/\r?\n/).map((l) => l.trim());
  // A list typed with no bullets at all is one item per line.
  const bulleted = rows.some((l) => BULLET.test(l));
  const isItem = (l: string) => (bulleted ? BULLET.test(l) : l !== "" && !l.endsWith(":"));
  const lines: ImportedLine[] = [];
  let category: string | null = null;
  let supplierId: string | null = null;

  rows.forEach((row, i) => {
    if (row === "") return;
    if (isItem(row)) {
      const line = parseItem(row.replace(BULLET, ""));
      if (line) lines.push({ ...line, category, supplierId });
      return;
    }
    const supplier = supplierTitled(row, suppliers);
    if (supplier) {
      supplierId = supplier.id;
      category = null;
      return;
    }
    // Only a title right above items is a category: the message's own
    // first line, or a greeting, is not.
    const next = rows[i + 1];
    category = next !== undefined && isItem(next) ? cleanTitle(row) : null;
  });
  return lines;
}

function supplierTitled(row: string, suppliers: Supplier[]): Supplier | undefined {
  const title = cleanTitle(row);
  return suppliers.find((s) => s.name.trim() === title);
}

const cleanTitle = (row: string) => row.replace(WHATSAPP_MARKUP, "").replace(/:\s*$/, "").trim();

type ParsedItem = Omit<ImportedLine, "category" | "supplierId">;

/** One item's text, its bullet removed. Null for a line with no name. */
export function parseItem(text: string): ParsedItem | null {
  const plain = text.replace(WHATSAPP_MARKUP, "").replace(/\s+/g, " ").trim();
  const [head, ...tail] = plain.split(SEPARATOR);
  if (tail.length) return item(head, parseDetail(tail.join(" – ")));
  // No dash: the quantity may stand before the name or after it.
  const before = /^(\d+) (.+)$/.exec(plain);
  const after = /^(.+?) (\d+)$/.exec(plain);
  const named = splitNote(before ? before[2] : after ? after[1] : plain);
  const quantity = before ? Number(before[1]) : after ? Number(after[2]) : null;
  return item(named.text, { quantity, measure: null, notes: [named.note] });
}

interface Detail { quantity: number | null; measure: string | null; notes: (string | null)[] }

/** What follows the dash: "2 שקים (בסמטי)", or words only, which are a note. */
function parseDetail(detail: string): Detail {
  const { text, note } = splitNote(detail);
  const counted = /^(\d+)(?: (\S+))?(?: (.+))?$/.exec(text);
  if (!counted) return { quantity: null, measure: null, notes: [text, note] };
  const [, quantity, word, more] = counted;
  const measure = word && word.length <= MEASURE_MAX_LENGTH ? word : null;
  return { quantity: Number(quantity), measure, notes: [measure ? null : word, more, note] };
}

function item(name: string, { quantity, measure, notes }: Detail): ParsedItem | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return {
    name: trimmed,
    quantity: quantity === null ? null : Math.max(1, quantity),
    measure,
    note: notes.filter(Boolean).join(", ") || null,
  };
}

/** "שום טרי (אם אין, כתוש)" → the text and the note in its last parentheses. */
function splitNote(text: string): { text: string; note: string | null } {
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(text.trim());
  return m && m[1] ? { text: m[1], note: m[2].trim() || null } : { text: text.trim(), note: null };
}

// Matching ---------------------------------------------------------------------

/** What one line becomes: an existing item, or a new one (itemId null) of a supplier. */
export interface ImportChoice {
  supplierId: string | null;
  itemId: string | null;
  quantity: number;
  measure: string;
}

/**
 * The line's supplier and item from the catalog matches of each supplier, in
 * the screen's order: the supplier it sat under, else the first with an exact
 * match, else the first with a "did you mean". With none, a new item.
 */
export function chooseMatch(line: ImportedLine, matches: Map<string, ItemMatch[]>, supplierOrder: string[]): ImportChoice {
  const candidates = line.supplierId ? [line.supplierId] : supplierOrder;
  const found = (pick: (m: ItemMatch[]) => ItemMatch | undefined) => {
    for (const supplierId of candidates) {
      const match = pick(matches.get(supplierId) ?? []);
      if (match) return { supplierId, match };
    }
    return null;
  };
  const best = found((m) => m.find((x) => x.exact)) ?? found((m) => m[0]);
  return {
    supplierId: best?.supplierId ?? line.supplierId,
    itemId: best?.match.id ?? null,
    quantity: line.quantity ?? best?.match.default_quantity ?? 1,
    measure: line.measure ?? best?.match.default_measure ?? "",
  };
}

/** The item already has an open request in the list, so importing it again would double it. */
export const isAlreadyListed = (itemId: string | null, rows: Request[]) =>
  itemId !== null && rows.some((r) => r.item_id === itemId && r.status !== "cancelled" && r.status !== "collected");
