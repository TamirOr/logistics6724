// A free-text category with the supplier's existing categories as
// suggestions. The server spells a near match like the existing one.
import { useEffect, useId, useState } from "react";
import { supplierCategories } from "../lib/api";
import { t } from "../strings";

export const CATEGORY_MAX_LENGTH = 30;

interface Props {
  supplierId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function CategoryInput({ supplierId, value, onChange, placeholder = t.categoryOptional, className = "input" }: Props) {
  const listId = useId();
  const [categories, setCategories] = useState<string[]>([]);
  useEffect(() => {
    supplierCategories(supplierId).then(setCategories).catch(() => setCategories([]));
  }, [supplierId]);
  return (
    <>
      <input className={className} dir="auto" list={listId} aria-label={t.category} placeholder={placeholder}
        value={value} maxLength={CATEGORY_MAX_LENGTH} autoComplete="off" enterKeyHint="done"
        onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
    </>
  );
}
