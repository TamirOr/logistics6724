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
  /** Shown beside a category's title, e.g. to act on all its rows. */
  titleAction?: (category: string | null, rows: T[]) => ReactNode;
}

export function CategorizedList<T>({ rows, categoryOf, renderRow, className = "req-list", titleAction }: Props<T>) {
  const groups = groupByCategory(rows, categoryOf);
  if (!hasCategories(groups)) return <ul className={className}>{rows.map(renderRow)}</ul>;
  return (
    <>
      {groups.map((g) => (
        <div key={g.category ?? ""} className="category-group">
          <div className="category-head">
            <h4 className="category-title" dir="auto">{g.category ?? t.generalCategory}</h4>
            {titleAction?.(g.category, g.rows)}
          </div>
          <ul className={className}>{g.rows.map(renderRow)}</ul>
        </div>
      ))}
    </>
  );
}
