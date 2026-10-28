// Cleanup outside live work: rename, hide, verify and merge catalog items.
import { useState } from "react";
import { Layout } from "../../components/Layout";
import { SupplierSwitcher } from "../../components/SupplierSwitcher";
import { Sheet } from "../../components/Sheet";
import { useAction, useToast } from "../../components/Toast";
import { addItem, matchItem, mergeItem, updateItem } from "../../lib/api";
import { describeError, isItemNameTaken } from "../../lib/errors";
import { useLiveRows } from "../../lib/live";
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
      await updateItem(item.id, patch);
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
      <ul className="req-list">
        {shown.map((i) => (
          <li key={i.id} className={`req ${i.active ? "" : "req-cancelled"}`}>
            <button className="req-main" onClick={() => setEditing(i)}>
              <span className="req-name user-text" dir="auto">{i.name}</span>
              {!i.verified && <span className="tag tag-new">{t.newTag}</span>}
              {!i.active && <span className="tag">{t.hidden}</span>}
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <ItemSheet item={editing} onClose={() => setEditing(null)}
          onSave={(patch) => saveItem(editing, patch)}
          onMerge={() => { setMerging(editing); setEditing(null); }} />
      )}
      {merging && (
        <MergeSheet source={merging} candidates={items.filter((i) => i.id !== merging.id && i.active)}
          onClose={() => setMerging(null)}
          onPick={(target) => { setMerging(null); attempt(() => mergeItem(merging.id, target.id)); }} />
      )}
    </Layout>
  );
}

function ItemSheet({ item, onClose, onSave, onMerge }: {
  item: Item; onClose: () => void; onSave: (patch: Partial<Item>) => void; onMerge: () => void;
}) {
  const [name, setName] = useState(item.name);
  const save = (patch: Partial<Item>) => {
    onSave(patch);
    onClose();
  };
  return (
    <Sheet title={<span dir="auto">{item.name}</span>} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t.rename}</span>
          <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn btn-primary btn-block" disabled={!name.trim() || name === item.name}
          onClick={() => save({ name: name.trim() })}>{t.save}</button>
        <div className="button-grid">
          {!item.verified && <button className="btn btn-secondary" onClick={() => save({ verified: true })}>{t.verifyItem}</button>}
          <button className="btn btn-secondary" onClick={() => save({ active: !item.active })}>
            {item.active ? t.hide : t.show}
          </button>
          <button className="btn btn-secondary" onClick={onMerge}>{t.merge}</button>
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
