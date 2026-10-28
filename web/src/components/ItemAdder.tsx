// The add row at the end of a supplier section: a name with autocomplete
// from that supplier's catalog, then a measure, then the quantity. A picked
// item offers its measures in a dropdown; a new item takes a typed one. The
// measure is optional either way. An unknown name first offers
// "התכוונת ל...?", and creates an unverified item only if the user insists.
// A new item may take a category; a picked item shows its own, which only
// the supplier changes.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { addItem, matchItem, searchItems } from "../lib/api";
import { itemCache, useCached } from "../lib/live";
import type { ItemSearchResult } from "../lib/types";
import { CategoryInput } from "./CategoryInput";
import { QuantityInput } from "./QuantityInput";
import { useAction } from "./Toast";
import { t } from "../strings";

interface Props {
  supplierId: string;
  onAdd: (itemId: string, quantity: number, measure: string) => void;
}

interface Defaults { default_quantity: number | null; default_measure: string | null }
interface Entered { quantity: number; quantityTouched: boolean; measure: string; measureTouched: boolean }

const NO_DEFAULTS: Defaults = { default_quantity: null, default_measure: null };

/** What the user entered, with the company's last quantity and measure for what they left alone. */
export function resolveAddition(entered: Entered, defaults: Defaults = NO_DEFAULTS) {
  const quantity = entered.quantityTouched || defaults.default_quantity == null ? entered.quantity : defaults.default_quantity;
  const measure = entered.measureTouched ? entered.measure : defaults.default_measure ?? entered.measure;
  return { quantity: Math.max(1, quantity), measure };
}

const SEARCH_DEBOUNCE_MS = 150;
const MEASURE_MAX_LENGTH = 30;
// The dropdown's "new measure" option. Stored measures are trimmed, so none equals it.
const NEW_MEASURE = "\n";

export function ItemAdder({ supplierId, onAdd }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [measure, setMeasure] = useState("");
  const [measureTouched, setMeasureTouched] = useState(false);
  const [typingMeasure, setTypingMeasure] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [quantityTouched, setQuantityTouched] = useState(false);
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ItemSearchResult | null>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const runAction = useAction();
  const itemOf = useCached(itemCache, selected ? [selected.id] : []);
  const selectedCategory = selected && itemOf(selected.id)?.category;

  const measureOptions = selected?.measures ?? [];
  const showMeasureDropdown = measureOptions.length > 0 && !typingMeasure
    && (measure === "" || measureOptions.includes(measure));

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
    setCategory("");
    setMeasure("");
    setMeasureTouched(false);
    setTypingMeasure(false);
    setQuantity(1);
    setQuantityTouched(false);
    nameRef.current?.focus();
  };

  const add = (itemId: string, defaults?: Defaults) => {
    const addition = resolveAddition({ quantity, quantityTouched, measure, measureTouched }, defaults);
    onAdd(itemId, addition.quantity, addition.measure);
    reset();
  };

  const pick = (item: ItemSearchResult) => {
    setSelected(item);
    setName(item.name);
    setOpen(false);
    setTypingMeasure(false);
    if (!measureTouched) setMeasure(item.default_measure ?? "");
    if (!quantityTouched) setQuantity(item.default_quantity ?? 1);
  };

  const changeName = (value: string) => {
    setName(value);
    setSelected(null);
    setSuggestions(null);
    setOpen(true);
    if (!measureTouched) setMeasure("");
  };

  const chooseMeasure = (value: string) => {
    setMeasureTouched(true);
    if (value === NEW_MEASURE) {
      setTypingMeasure(true);
      setMeasure("");
    } else {
      setMeasure(value);
    }
  };

  const runBusy = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await runAction(action);
    setBusy(false);
  };

  const create = async () => add(await addItem(supplierId, name, category));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (selected) return add(selected.id);
    const typed = name.trim();
    if (!typed) return;
    runBusy(async () => {
      // The server normalizes (geresh, plurals, final letters), so "גריקן מים"
      // finds "ג׳ריקן מים" without asking.
      const matches = await matchItem(supplierId, typed);
      const exact = matches.find((m) => m.exact);
      if (exact) add(exact.id, exact);
      else if (matches.length) setSuggestions(matches);
      else await create();
    });
  };

  return (
    <form className="adder" onSubmit={submit}>
      <div className="adder-row">
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
            onChange={(e) => changeName(e.target.value)}
          />
          {open && results.length > 0 && (
            <ul className="combo-list" role="listbox">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" className="combo-option" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                    <span dir="auto" className="user-text">{r.name}</span>
                    {r.default_quantity != null && (
                      <span className="muted">{r.default_quantity}{r.default_measure && ` ${r.default_measure}`}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {showMeasureDropdown ? (
          <select className="input measure-field" aria-label={t.measure} value={measure}
            onChange={(e) => chooseMeasure(e.target.value)}>
            <option value="">{t.noMeasure}</option>
            {measureOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={NEW_MEASURE}>{t.newMeasure}</option>
          </select>
        ) : (
          <input
            className="input measure-field"
            dir="auto"
            placeholder={t.measure}
            aria-label={t.measure}
            value={measure}
            maxLength={MEASURE_MAX_LENGTH}
            autoComplete="off"
            autoFocus={typingMeasure}
            enterKeyHint="done"
            onChange={(e) => { setMeasure(e.target.value); setMeasureTouched(true); }}
          />
        )}
      </div>

      {selected ? selectedCategory && (
        <div className="muted adder-category">{t.category}: <span dir="auto" className="user-text">{selectedCategory}</span></div>
      ) : name.trim() && (
        <div className="adder-row adder-category">
          <CategoryInput supplierId={supplierId} value={category} onChange={setCategory} />
        </div>
      )}

      <div className="adder-row">
        <QuantityInput value={quantity} onChange={(v) => { setQuantity(v); setQuantityTouched(true); }} />
        <button className="btn btn-primary adder-submit" type="submit" disabled={busy || !name.trim()}>{t.add}</button>
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
