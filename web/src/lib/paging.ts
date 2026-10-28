// PostgREST answers at most 1,000 rows per request and says nothing when it
// cuts a result short. Queries that can grow past that read every page.
export const PAGE_SIZE = 1000;

interface Ranged<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Every row of a query, read a page at a time until a short page comes
 * back. The query must be ordered with no ties, or rows can repeat or go
 * missing between pages. It is built anew for each page.
 */
export async function allRows<T>(query: () => Ranged<T>): Promise<T[]> {
  const result: T[] = [];
  for (;;) {
    const { data, error } = await query().range(result.length, result.length + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    result.push(...page);
    if (page.length < PAGE_SIZE) return result;
  }
}
