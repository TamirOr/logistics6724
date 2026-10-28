import { describe, expect, it } from "vitest";
import { allRows, PAGE_SIZE } from "./paging";

function fakeQuery(total: number, ranges: [number, number][] = []) {
  const rows = Array.from({ length: total }, (_, i) => i);
  return () => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    },
  });
}

describe("allRows", () => {
  it("reads past the server's row cap", async () => {
    const ranges: [number, number][] = [];
    const rows = await allRows(fakeQuery(PAGE_SIZE * 2 + 5, ranges));
    expect(rows).toHaveLength(PAGE_SIZE * 2 + 5);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("asks once more when the last page is exactly full", async () => {
    const ranges: [number, number][] = [];
    expect(await allRows(fakeQuery(PAGE_SIZE, ranges))).toHaveLength(PAGE_SIZE);
    expect(ranges).toHaveLength(2);
  });

  it("stops at the first short page", async () => {
    const ranges: [number, number][] = [];
    expect(await allRows(fakeQuery(3, ranges))).toEqual([0, 1, 2]);
    expect(ranges).toHaveLength(1);
  });

  it("throws the server's error instead of returning part of the rows", async () => {
    const error = { message: "boom" };
    await expect(allRows(() => ({ range: async () => ({ data: null, error }) }))).rejects.toBe(error);
  });
});
