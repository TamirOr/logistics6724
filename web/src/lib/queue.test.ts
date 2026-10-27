import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const refreshSession = vi.fn(async () => ({ data: {}, error: null }));
vi.mock("./supabase", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["insert", "update", "delete", "eq", "select"]) b[m] = () => b;
    b.single = () => send();
    b.maybeSingle = () => send();
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(send()).then(resolve);
    return b;
  };
  return { supabase: { from: builder, rpc: () => send(), auth: { refreshSession } } };
});

// Long enough for one flush, shorter than the first retry backoff (1s).
const flushTimers = () => vi.advanceTimersByTimeAsync(10);
const stored = (user = "u1") => JSON.parse(localStorage.getItem(`write-queue-v1:${user}`) ?? "[]");

/** A fresh queue module, signed in as u1. */
async function freshQueue() {
  const q = await import("./queue");
  q.setQueueUser("u1");
  return q;
}

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
    refreshSession.mockClear();
    localStorage.clear();
  });

  it("sends a write, drops it, and tells commit listeners", async () => {
    const q = await freshQueue();
    send.mockResolvedValue({ data: { id: "r1" }, error: null });
    const committed = vi.fn();
    q.onCommitted(committed);
    q.enqueue({ kind: "update", table: "requests", id: "r1", patch: { urgent: true } });
    await flushTimers();
    expect(send).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith(expect.anything(), { id: "r1" });
  });

  it("keeps a write after a network error and retries it", async () => {
    const q = await freshQueue();
    send.mockResolvedValueOnce({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } })
      .mockResolvedValueOnce({ data: null, error: null });
    q.enqueue({ kind: "rpc", fn: "mark_collected", args: {} });
    await flushTimers();
    expect(stored()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(stored()).toHaveLength(0);
  });

  it("drops a write the server rejects and tells reject listeners", async () => {
    const q = await freshQueue();
    send.mockResolvedValue({ data: null, error: { message: "request is closed", code: "P0001" } });
    const rejected = vi.fn();
    q.onRejected(rejected);
    q.enqueue({ kind: "update", table: "requests", id: "r1", patch: { quantity: 2 } });
    await flushTimers();
    expect(rejected).toHaveBeenCalledWith(expect.anything(), "request is closed");
    expect(stored()).toHaveLength(0);
  });

  it("treats a duplicate-key insert as already applied", async () => {
    const q = await freshQueue();
    send.mockResolvedValue({ data: null, error: { message: "duplicate key", code: "23505" } });
    const rejected = vi.fn();
    q.onRejected(rejected);
    q.enqueue({ kind: "insert", table: "requests", row: { id: "r1" } });
    await flushTimers();
    expect(rejected).not.toHaveBeenCalled();
  });

  it("waits out the undo delay, and cancel stops the write", async () => {
    const q = await freshQueue();
    send.mockResolvedValue({ data: null, error: null });
    const id = q.enqueue({ kind: "rpc", fn: "delete_request", args: {} }, [], 5000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(send).not.toHaveBeenCalled();
    expect(q.cancel(id)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).not.toHaveBeenCalled();
  });

  it("refreshes an expired session and keeps the write for a retry", async () => {
    const q = await freshQueue();
    send.mockResolvedValueOnce({ data: null, error: { message: "JWT expired", code: "PGRST301" } })
      .mockResolvedValueOnce({ data: null, error: null });
    const rejected = vi.fn();
    q.onRejected(rejected);
    q.enqueue({ kind: "update", table: "requests", id: "r1", patch: { urgent: true } });
    await flushTimers();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(rejected).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(stored()).toHaveLength(0);
  });

  it("never sends one user's writes while another user is signed in", async () => {
    const q = await freshQueue();
    send.mockResolvedValue({ data: null, error: { message: "Failed to fetch", code: "" } });
    q.enqueue({ kind: "rpc", fn: "mark_collected", args: {} });
    await flushTimers();
    send.mockClear();
    send.mockResolvedValue({ data: null, error: null });

    q.setQueueUser("u2");
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    expect(stored("u1")).toHaveLength(1);

    q.setQueueUser("u1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(stored("u1")).toHaveLength(0);
  });

  it("sends nothing while signed out, and clearQueue drops unsent writes", async () => {
    const q = await freshQueue();
    q.setQueueUser(null);
    q.enqueue({ kind: "rpc", fn: "mark_collected", args: {} });
    await flushTimers();
    expect(send).not.toHaveBeenCalled();

    q.setQueueUser("u1");
    q.enqueue({ kind: "rpc", fn: "mark_collected", args: {} }, [], 5000);
    q.clearQueue();
    await vi.advanceTimersByTimeAsync(6000);
    expect(send).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(0);
  });
});
