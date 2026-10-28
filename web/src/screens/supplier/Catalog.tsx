// Cleanup outside live work: rename, categorize, hide, verify, merge and delete
// catalog items. Items show under their categories.
import { useState } from "react";
import { CategorizedList } from "../../components/CategorizedList";
import { CategoryInput } from "../../components/CategoryInput";
import { Layout } from "../../components/Layout";
import { SupplierSwitcher } from "../../components/SupplierSwitcher";
import { Sheet } from "../../components/Sheet";
import { useAction, useToast } from "../../components/Toast";
import { addItem, deleteItem, matchItem, mergeItem, updateItem } from "../../lib/api";
import { describeError, isItemNameTaken } from "../../lib/errors";
import { itemCache, useLiveRows } from "../../lib/live";
import { useActiveSupplier } from "../../lib/activeSupplier";
import type { Item } from "../../lib/types";
import { t } from "../../strings";

const nameIncludes = (i: Item, q: string) => i.name.toLowerCase().includes(q.trim().toLowerCase());

export function Catalog() {
  const supplierId = useActiveSupplier();
  const runAction = useAction();
  const showToast = useToast();
  const { rows: items, refetch } = useLiveRows<Item>("items", { column: "supplier_id", value: supplierId });
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [merging, setMerging] = useState<Item | null>(null);

  const attempt = (action: () => Promise<unknown>) => runAction(action, refetch);

  // A rename onto a name the catalog already has: offer to merge into it.
  const saveItem = async (item: Item, patch: Partial<Item>) => {
    try {
      // Other screens read items from the cache, so they regroup at once.
      itemCache.put([await updateItem(item.id, patch)]);
      await refetch();
    } catch (error) {
      const existing = isItemNameTaken(error) && patch.name
        ? (await matchItem(item.supplier_id, patch.name).catch(() => [])).find((m) => m.exact)
        : undefined;
      if (existing) {
        showToast({ message: t.nameTakenMerge(existing.name), actionLabel: t.merge,
          onAction: () => attempt(() => mergeItem(item.id, existing.id)) });
      } else {
        showToast({ message: describeError(error) });
      }
    }
  };

  const shown = items.filter((i) => nameIncludes(i, filter))
    .sort((a, b) => Number(a.verified) - Number(b.verified) || a.name.localeCompare(b.name, "he"));

  return (
    <Layout title={t.catalog} back>
      <SupplierSwitcher />
      <div className="toolbar">
        <input className="input" dir="auto" placeholder={t.searchCatalog} value={filter}
          onChange={(e) => setFilter(e.target.value)} />
        <button className="btn btn-secondary" disabled={!filter.trim()}
          onClick={() => attempt(async () => { await addItem(supplierId, filter); setFilter(""); })}>
          {t.addCatalogItem}
        </button>
      </div>
      <CategorizedList rows={shown} categoryOf={(i) => i.category} renderRow={(i) => (
        <li key={i.id} className={`req ${i.active ? "" : "req-cancelled"}`}>
          <button className="req-main" onClick={() => setEditing(i)}>
            <span className="req-name user-text" dir="auto">{i.name}</span>
            {!i.verified && <span className="tag tag-new">{t.newTag}</span>}
            {!i.active && <span className="tag">{t.hidden}</span>}
          </button>
        </li>
      )} />

      {editing && (
        <ItemSheet item={editing} onClose={() => setEditing(null)}
          onSave={(patch) => saveItem(editing, patch)}
          onMerge={() => { setMerging(editing); setEditing(null); }}
          onDelete={() => attempt(() => deleteItem(editing.id))} />
      )}
      {merging && (
        <MergeSheet source={merging} candidates={items.filter((i) => i.id !== merging.id && i.active)}
          onClose={() => setMerging(null)}
          onPick={(target) => { setMerging(null); attempt(() => mergeItem(merging.id, target.id)); }} />
      )}
    </Layout>
  );
}

function ItemSheet({ item, onClose, onSave, onMerge, onDelete }: {
  item: Item; onClose: () => void; onSave: (patch: Partial<Item>) => void; onMerge: () => void; onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");
  const edits: Partial<Item> = {
    ...(name.trim() !== item.name && { name: name.trim() }),
    ...(category.trim() !== (item.category ?? "") && { category: category.trim() || null }),
  };
  const save = (patch: Partial<Item>) => {
    onSave(patch);
    onClose();
  };
  // Deleting cannot be undone, so unlike hiding it asks first.
  const confirmAndDelete = () => {
    if (!window.confirm(t.confirmDeleteItem(item.name))) return;
    onDelete();
    onClose();
  };
  return (
    <Sheet title={<span dir="auto">{item.name}</span>} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t.rename}</span>
          <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field"><span>{t.category}</span>
          <CategoryInput supplierId={item.supplier_id} value={category} onChange={setCategory} />
        </label>
        <button className="btn btn-primary btn-block" disabled={!name.trim() || Object.keys(edits).length === 0}
          onClick={() => save(edits)}>{t.save}</button>
        <div className="button-grid">
          {!item.verified && <button className="btn btn-secondary" onClick={() => save({ verified: true })}>{t.verifyItem}</button>}
          <button className="btn btn-secondary" onClick={() => save({ active: !item.active })}>
            {item.active ? t.hide : t.show}
          </button>
          <button className="btn btn-secondary" onClick={onMerge}>{t.merge}</button>
          <button className="btn btn-danger" onClick={confirmAndDelete}>{t.deleteItem}</button>
        </div>
      </div>
    </Sheet>
  );
}

function MergeSheet({ source, candidates, onClose, onPick }: {
  source: Item; candidates: Item[]; onClose: () => void; onPick: (target: Item) => void;
}) {
  const [q, setQ] = useState("");
  const shown = candidates.filter((c) => nameIncludes(c, q));
  return (
    <Sheet title={<>{t.mergeWith}: <span dir="auto">{source.name}</span></>} onClose={onClose}>
      <input className="input" dir="auto" placeholder={t.searchCatalog} value={q} autoFocus
        onChange={(e) => setQ(e.target.value)} />
      <ul className="req-list">
        {shown.map((c) => (
          <li key={c.id} className="req">
            <button className="req-main" onClick={() => onPick(c)}>
              <span className="req-name user-text" dir="auto">{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
