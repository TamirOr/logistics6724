import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("./supabase", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["insert", "update", "delete", "eq", "select"]) b[m] = () => b;
    b.single = () => send();
    b.maybeSingle = () => send();
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(send()).then(resolve);
    return b;
  };
  return { supabase: { from: builder, rpc: () => send() } };
});

// Long enough for one flush, shorter than the first retry backoff (1s).
const flushTimers = () => vi.advanceTimersByTimeAsync(10);

describe("applyEffects", async () => {
  const { applyEffects } = await import("./queue");
  const rows = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
  const entry = (effects: unknown[]) => ({ id: "e", mutation: { kind: "rpc", fn: "f", args: {} }, effects, notBefore: 0, tries: 0 }) as never;

  it("patches, removes and inserts in queue order", () => {
    const result = applyEffects("t", rows, [
      entry([{ table: "t", id: "a", patch: { n: 10 } }]),
      entry([{ table: "t", id: "b", remove: true }]),
      entry([{ table: "t", id: "c", insert: { id: "c", n: 3 } }]),
      entry([{ table: "t", id: "a", patch: { n: 11 } }]),
    ]);
    expect(result).toEqual([{ id: "a", n: 11 }, { id: "c", n: 3 }]);
  });

  it("ignores effects on other tables and does not duplicate inserts the server already has", () => {
    const result = applyEffects("t", rows, [
      entry([{ table: "other", id: "a", patch: { n: 99 } }]),
      entry([{ table: "t", id: "b", insert: { id: "b", n: 0 } }]),
    ]);
    expect(result).toEqual(rows);
  });
});

describe("queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    send.mockReset();
    localStorage.clear();
  });

  it("sends a write, drops it, and tells commit listeners", async () => {
    const q = await import("./queue");
    send.mockResolvedValue({ data: { id: "r1" }, error: null });
    const committed = vi.fn();
    q.onCommitted(committed);
    q.enqueue({ kind: "update", table: "requests", id: "r1", patch: { urgent: true } });
    await flushTimers();
    expect(send).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith(expect.anything(), { id: "r1" });
  });

  it("keeps a write after a network error and retries it", async () => {
    const q = await import("./queue");
    send.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } })
      .mockResolvedValueOnce({ data: null, error: null });
    q.enqueue({ kind: "rpc", fn: "mark_collected", args: {} });
    await flushTimers();
    expect(JSON.parse(localStorage.getItem("write-queue-v1")!)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem("write-queue-v1")!)).toHaveLength(0);
  });

  it("drops a write the server rejects and tells reject listeners", async () => {
    const q = await import("./queue");
    send.mockResolvedValue({ data: null, error: { message: "request is closed", code: "P0001" } });
    const rejected = vi.fn();
    q.onRejected(rejected);
    q.enqueue({ kind: "update", table: "requests", id: "r1", patch: { quantity: 2 } });
    await flushTimers();
    expect(rejected).toHaveBeenCalledWith(expect.anything(), "request is closed");
    expect(JSON.parse(localStorage.getItem("write-queue-v1")!)).toHaveLength(0);
  });

  it("treats a duplicate-key insert as already applied", async () => {
    const q = await import("./queue");
    send.mockResolvedValue({ data: null, error: { message: "duplicate key", code: "23505" } });
    const rejected = vi.fn();
    q.onRejected(rejected);
    q.enqueue({ kind: "insert", table: "requests", row: { id: "r1" } });
    await flushTimers();
    expect(rejected).not.toHaveBeenCalled();
  });

  it("waits out the undo delay, and cancel stops the write", async () => {
    const q = await import("./queue");
    send.mockResolvedValue({ data: null, error: null });
    const id = q.enqueue({ kind: "rpc", fn: "delete_request", args: {} }, [], 5000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(send).not.toHaveBeenCalled();
    expect(q.cancel(id)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).not.toHaveBeenCalled();
  });
});
