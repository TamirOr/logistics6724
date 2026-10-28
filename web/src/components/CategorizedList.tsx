// A list of rows under their item's category titles. With no categories at
// all it is one plain list, as before categories existed.
import type { ReactNode } from "react";
import { groupByCategory, hasCategories } from "../lib/categories";
import { t } from "../strings";

interface Props<T> {
  rows: T[];
  categoryOf: (row: T) => string | null | undefined;
  renderRow: (row: T) => ReactNode;
  className?: string;
}

export function CategorizedList<T>({ rows, categoryOf, renderRow, className = "req-list" }: Props<T>) {
  const groups = groupByCategory(rows, categoryOf);
  if (!hasCategories(groups)) return <ul className={className}>{rows.map(renderRow)}</ul>;
  return (
    <>
      {groups.map((g) => (
        <div key={g.category ?? ""} className="category-group">
          <h4 className="category-title" dir="auto">{g.category ?? t.generalCategory}</h4>
          <ul className={className}>{g.rows.map(renderRow)}</ul>
        </div>
      ))}
    </>
  );
}
