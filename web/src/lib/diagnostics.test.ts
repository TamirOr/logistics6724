import { beforeEach, describe, expect, it } from "vitest";
import { type DiagnosticsInfo, diagnosticsText, noteRejected, readRejected, withRejected } from "./diagnostics";

const info: DiagnosticsInfo = {
  appVersion: "abc1234", workerVersion: "abc1234", updateWaiting: true,
  userId: "10000000-0000-0000-0000-000000000002", role: "customer", unit: "פלוגה א", approval: "approved",
  online: false, lastSync: Date.UTC(2026, 9, 27, 8), queueLength: 2, oldestQueuedAt: 1_000, oldestQueuedTries: 3,
  pushPermission: "granted", pushSubscribed: true, pushSubscriptionId: "abcdef12-3456",
  standalone: true, userAgent: "iPhone",
  rejected: [{ at: Date.UTC(2026, 9, 27, 9), kind: "update", target: "requests", code: "42501" }],
};

describe("diagnostics text", () => {
  it("has every field support needs, with short ids", () => {
    const text = diagnosticsText(info, 61_000);
    expect(text).toContain("app: abc1234 / sw: abc1234 (update waiting)");
    expect(text).toContain("user: 10000000 customer פלוגה א approved");
    expect(text).toContain("online: no, last sync: 2026-10-27T08:00:00.000Z");
    expect(text).toContain("queue: 2, oldest: 60s, tries: 3");
    expect(text).toContain("push: granted, subscribed: yes, id: abcdef12");
    expect(text).toContain("mode: home screen");
    expect(text).toContain("rejected: 2026-10-27T09:00:00.000Z update requests 42501");
    expect(text).not.toContain("0000-0000-0000-000000000002");
  });

  it("shows dashes for what is unknown", () => {
    const text = diagnosticsText({ ...info, workerVersion: null, userId: null, lastSync: null, oldestQueuedAt: null,
      oldestQueuedTries: null, pushSubscriptionId: null, rejected: [] });
    expect(text).toContain("sw: -");
    expect(text).toContain("last sync: -");
    expect(text).toContain("oldest: -, tries: -");
    expect(text).not.toContain("rejected:");
  });
});

describe("rejected writes", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the newest five, newest first", () => {
    let list = withRejected([], { at: 0, kind: "insert", target: "requests", code: "1" });
    for (let i = 1; i <= 5; i++) list = withRejected(list, { at: i, kind: "insert", target: "requests", code: String(i + 1) });
    expect(list.map((r) => r.at)).toEqual([5, 4, 3, 2, 1]);
  });

  it("records the mutation kind, target and code, not the values written", () => {
    noteRejected({ kind: "update", table: "requests", id: "r1", patch: { supplier_note: "סוד" } }, "42501", 7);
    noteRejected({ kind: "rpc", fn: "mark_collected", args: {} }, undefined, 8);
    expect(readRejected()).toEqual([
      { at: 8, kind: "rpc", target: "mark_collected", code: "none" },
      { at: 7, kind: "update", target: "requests", code: "42501" },
    ]);
    expect(JSON.stringify(localStorage)).not.toContain("סוד");
  });
});
