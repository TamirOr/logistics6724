// The add row at the end of a supplier section: quantity, then a name with
// autocomplete from that supplier's catalog. An unknown name first offers
// "התכוונת ל...?", and creates an unverified item only if the user insists.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { addItem, searchItems, suggestItems } from "../lib/api";
import type { ItemSearchResult } from "../lib/types";
import { QuantityInput } from "./QuantityInput";
import { useAction } from "./Toast";
import { t } from "../strings";

interface Props {
  supplierId: string;
  onAdd: (itemId: string, quantity: number) => void;
}

const SEARCH_DEBOUNCE_MS = 150;

export function ItemAdder({ supplierId, onAdd }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [quantityTouched, setQuantityTouched] = useState(false);
  const [name, setName] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ItemSearchResult | null>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const runAction = useAction();

  useEffect(() => {
    if (!open || selected) return;
    const timer = setTimeout(() => {
      searchItems(supplierId, name).then(setResults).catch(() => setResults([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [name, open, selected, supplierId]);

  const reset = () => {
    setName("");
    setSelected(null);
    setSuggestions(null);
    setResults([]);
    setQuantity(1);
    setQuantityTouched(false);
    nameRef.current?.focus();
  };

  const add = (itemId: string) => {
    onAdd(itemId, Math.max(1, quantity));
    reset();
  };

  const pick = (item: ItemSearchResult) => {
    setSelected(item);
    setName(item.name);
    setOpen(false);
    if (!quantityTouched) setQuantity(item.default_quantity ?? 1);
  };

  const runBusy = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await runAction(action);
    setBusy(false);
  };

  const create = async () => add(await addItem(supplierId, name));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (selected) return add(selected.id);
    const typed = name.trim();
    if (!typed) return;
    runBusy(async () => {
      const found = await suggestItems(supplierId, typed);
      const exact = found.find((s) => s.name === typed);
      if (exact) add(exact.id);
      else if (found.length) setSuggestions(found);
      else await create();
    });
  };

  return (
    <form className="adder" onSubmit={submit}>
      <div className="adder-row">
        <QuantityInput value={quantity} onChange={(v) => { setQuantity(v); setQuantityTouched(true); }} />
        <div className="combo">
          <input
            ref={nameRef}
            className="input"
            dir="auto"
            placeholder={t.itemName}
            aria-label={t.itemName}
            value={name}
            autoComplete="off"
            enterKeyHint="done"
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => { setName(e.target.value); setSelected(null); setSuggestions(null); setOpen(true); }}
          />
          {open && results.length > 0 && (
            <ul className="combo-list" role="listbox">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" className="combo-option" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                    <span dir="auto" className="user-text">{r.name}</span>
                    {r.default_quantity != null && <span className="muted">{r.default_quantity}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>{t.add}</button>
      </div>

      {suggestions && (
        <div className="did-you-mean">
          <div className="muted">{t.didYouMean}</div>
          {suggestions.map((s) => (
            <button key={s.id} type="button" className="btn btn-chip" onClick={() => add(s.id)}>
              <span dir="auto" className="user-text">{s.name}</span>
            </button>
          ))}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => runBusy(create)}>
            {t.addAnyway(name.trim())}
          </button>
        </div>
      )}
    </form>
  );
}
