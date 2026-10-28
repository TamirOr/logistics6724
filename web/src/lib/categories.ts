// Grouping by item category, so a supplier prepares a list shelf by shelf.
// Rows whose item has no category form the general group, shown last.

export interface CategoryGroup<T> {
  /** null: the general group. */
  category: string | null;
  rows: T[];
}

/** Groups in alphabetical order, the general group last. Rows keep their order within a group. */
export function groupByCategory<T>(rows: T[], categoryOf: (row: T) => string | null | undefined): CategoryGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const category = categoryOf(row) ?? null;
    groups.set(category, [...(groups.get(category) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([category, groupRows]) => ({ category, rows: groupRows }))
    .sort((a, b) => (a.category === null ? 1 : b.category === null ? -1 : a.category.localeCompare(b.category, "he")));
}

/** A list with no categories at all reads as one plain list, with no group titles. */
export const hasCategories = (groups: CategoryGroup<unknown>[]) => groups.some((g) => g.category !== null);
