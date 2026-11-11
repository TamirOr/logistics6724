// Pastes a list from WhatsApp, matches each line to a supplier's catalog and
// adds the chosen lines as requests. Each line shows what it will become, so
// the company fixes a wrong match before anything is added.
import { useState } from "react";
import { CATEGORY_MAX_LENGTH } from "../../components/CategoryInput";
import { QuantityInput } from "../../components/QuantityInput";
import { Sheet } from "../../components/Sheet";
import { useAction, useToast } from "../../components/Toast";
import { addItem, matchItem, type ItemMatch } from "../../lib/api";
import { addRequest, MEASURE_MAX_LENGTH } from "../../lib/requests";
import type { Request, Unit } from "../../lib/types";
import { chooseMatch, isAlreadyListed, parseWhatsAppList, type ImportChoice, type ImportedLine } from "../../lib/whatsAppImport";
import { t } from "../../strings";

interface Props {
  listId: string;
  eventId: string;
  companyId: string;
  suppliers: Unit[];
  /** The list's requests, to spot a line already on it. */
  rows: Request[];
  onClose: () => void;
}

interface Row {
  line: ImportedLine;
  /** Catalog matches of each supplier, for the item picker. */
  matches: Map<string, ItemMatch[]>;
  choice: ImportChoice;
  included: boolean;
}

export function WhatsAppImportSheet({ listId, eventId, companyId, suppliers, rows, onClose }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const runAction = useAction();
  const showToast = useToast();
  const supplierOrder = suppliers.map((s) => s.id);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await runAction(action);
    setBusy(false);
  };

  const read = () => run(async () => {
    const lines = parseWhatsAppList(text, suppliers);
    setEmpty(lines.length === 0);
    if (!lines.length) return;
    setPreview(await Promise.all(lines.map(async (line) => {
      const matches = await matchesOf(line.name, supplierOrder);
      const choice = chooseMatch(line, matches, supplierOrder);
      return { line, matches, choice, included: choice.supplierId !== null && !isAlreadyListed(choice.itemId, rows) };
    })));
  });

  const change = (index: number, patch: Partial<Row>) =>
    setPreview((current) => current!.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const changeChoice = (index: number, patch: Partial<ImportChoice>) =>
    change(index, { choice: { ...preview![index].choice, ...patch } });
  const changeSupplier = (index: number, supplierId: string) => {
    const row = preview![index];
    const { itemId } = chooseMatch({ ...row.line, supplierId }, row.matches, supplierOrder);
    change(index, { choice: { ...row.choice, supplierId, itemId }, included: true });
  };

  const isChosen = (r: Row) => r.included && r.choice.supplierId !== null;
  const chosen = (preview ?? []).filter(isChosen);
  const add = () => run(async () => {
    for (const [index, row] of preview!.entries()) {
      if (!isChosen(row)) continue;
      const { line, choice } = row;
      const supplierId = choice.supplierId!;
      const itemId = choice.itemId ?? await addItem(supplierId, line.name, categoryOfNewItem(line));
      addRequest({
        listId, eventId, companyId, supplierId, itemId,
        quantity: choice.quantity, measure: choice.measure, customerNote: line.note ?? "",
      });
      // Should a later line fail, pressing again must not add this one twice.
      change(index, { included: false });
    }
    showToast({ message: t.itemsImported(chosen.length) });
    onClose();
  });

  if (!preview) {
    return (
      <Sheet title={t.whatsAppImport} onClose={onClose}>
        <div className="stack">
          <p className="muted">{t.whatsAppPasteHint}</p>
          <textarea className="input whatsapp-text" dir="auto" value={text} rows={12} aria-label={t.whatsAppPaste}
            placeholder={t.whatsAppPaste} onChange={(e) => { setText(e.target.value); setEmpty(false); }} />
          {empty && <p className="notice">{t.nothingToImport}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !text.trim()} onClick={read}>
            {busy ? t.readingList : t.readList}
          </button>
          <button className="btn btn-ghost btn-block" onClick={onClose}>{t.close}</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={t.whatsAppImport} onClose={onClose}>
      <ul className="import-list">
        {preview.map((row, i) => (
          <ImportRow key={i} row={row} suppliers={suppliers} listed={isAlreadyListed(row.choice.itemId, rows)}
            onInclude={(included) => change(i, { included })}
            onSupplier={(supplierId) => changeSupplier(i, supplierId)}
            onChoice={(patch) => changeChoice(i, patch)} />
        ))}
      </ul>
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={busy || chosen.length === 0} onClick={add}>
          {t.importItems(chosen.length)}
        </button>
        <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setPreview(null)}>{t.backToText}</button>
      </div>
    </Sheet>
  );
}

/** A title too long for a category (a whole sentence) leaves the new item in the general group. */
const categoryOfNewItem = (line: ImportedLine) =>
  line.category && line.category.length <= CATEGORY_MAX_LENGTH ? line.category : "";

/** Every supplier's catalog match for one name, so the picker can switch supplier without asking again. */
async function matchesOf(name: string, supplierIds: string[]): Promise<Map<string, ItemMatch[]>> {
  const found = await Promise.all(supplierIds.map(async (id) => [id, await matchItem(id, name)] as const));
  return new Map(found);
}

interface RowProps {
  row: Row;
  suppliers: Unit[];
  listed: boolean;
  onInclude: (included: boolean) => void;
  onSupplier: (supplierId: string) => void;
  onChoice: (patch: Partial<ImportChoice>) => void;
}

function ImportRow({ row: { line, matches, choice, included }, suppliers, listed, onInclude, onSupplier, onChoice }: RowProps) {
  const options = choice.supplierId ? matches.get(choice.supplierId) ?? [] : [];
  return (
    <li className={`import-row${included ? "" : " import-row-off"}`}>
      <label className="import-row-head">
        <input type="checkbox" checked={included} disabled={!choice.supplierId}
          onChange={(e) => onInclude(e.target.checked)} />
        <span dir="auto" className="user-text">{line.name}</span>
        {listed && <span className="muted">· {t.alreadyListed}</span>}
      </label>
      {line.note && <div dir="auto" className="muted user-text">{line.note}</div>}
      <div className="adder-row">
        <select className="input" aria-label={t.supplierUnit} value={choice.supplierId ?? ""}
          onChange={(e) => onSupplier(e.target.value)}>
          {!choice.supplierId && <option value="">{t.pickSupplier}</option>}
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" aria-label={t.itemName} value={choice.itemId ?? ""} disabled={!choice.supplierId}
          onChange={(e) => onChoice({ itemId: e.target.value || null })}>
          {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="">{t.newItem(line.name)}</option>
        </select>
      </div>
      {choice.supplierId ? (
        <div className="adder-row">
          <QuantityInput value={choice.quantity} onChange={(quantity) => onChoice({ quantity })} />
          <input className="input measure-field" dir="auto" aria-label={t.measure} placeholder={t.measure}
            maxLength={MEASURE_MAX_LENGTH} value={choice.measure} onChange={(e) => onChoice({ measure: e.target.value })} />
        </div>
      ) : <div className="muted">{t.noSupplierYet}</div>}
    </li>
  );
}
