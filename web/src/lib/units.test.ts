import { beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.fn();
vi.mock("./supabase", () => ({ supabase: { from: () => ({ select }) } }));

beforeEach(() => {
  vi.resetModules();
  select.mockReset();
  localStorage.clear();
});

describe("loadUnits", () => {
  it("falls back to the saved units offline and tries the server again next time", async () => {
    const { loadUnits } = await import("./live");
    const units = [{ id: "c1", name: "פלוגה ב", kind: "company", headcount: null, active: true },
                   { id: "c2", name: "פלוגה א", kind: "company", headcount: 90, active: true }];
    select.mockResolvedValueOnce({ data: units, error: null });
    expect((await loadUnits()).map((u) => u.name)).toEqual(["פלוגה א", "פלוגה ב"]);

    select.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    expect((await loadUnits(true)).length).toBe(2);

    select.mockResolvedValueOnce({ data: [units[0]], error: null });
    expect((await loadUnits()).length).toBe(1);
    expect(select).toHaveBeenCalledTimes(3);
  });
});
