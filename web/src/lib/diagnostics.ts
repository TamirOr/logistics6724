// What the diagnostics screen shows about this phone, and the text its copy
// button produces for a support chat. Rejected writes are kept on the phone
// only and leave it only when the user copies them.
import { readCache, writeCache } from "./cache";
import type { Mutation } from "./queue";

export interface RejectedWrite { at: number; kind: Mutation["kind"]; target: string; code: string }

const REJECTED_KEY = "rejected-writes";
const LAST_SYNC_KEY = "last-sync";
const KEEP_REJECTED = 5;

/** The newest rejected writes, newest first. */
export function withRejected(list: RejectedWrite[], entry: RejectedWrite): RejectedWrite[] {
  return [entry, ...list].slice(0, KEEP_REJECTED);
}

export const readRejected = () => readCache<RejectedWrite[]>(REJECTED_KEY) ?? [];

export function noteRejected(mutation: Mutation, code: string | undefined, at = Date.now()) {
  const target = mutation.kind === "rpc" ? mutation.fn : mutation.table;
  writeCache(REJECTED_KEY, withRejected(readRejected(), { at, kind: mutation.kind, target, code: code ?? "none" }));
}

/** Called whenever the server answered: a write committed or rows loaded. */
export const noteSynced = (at = Date.now()) => writeCache(LAST_SYNC_KEY, at);
export const readLastSync = () => readCache<number>(LAST_SYNC_KEY);

export interface DiagnosticsInfo {
  appVersion: string;
  workerVersion: string | null;
  updateWaiting: boolean;
  userId: string | null;
  role: string | null;
  unit: string | null;
  approval: string | null;
  online: boolean;
  lastSync: number | null;
  queueLength: number;
  oldestQueuedAt: number | null;
  oldestQueuedTries: number | null;
  pushPermission: string;
  pushSubscribed: boolean;
  pushSubscriptionId: string | null;
  standalone: boolean;
  userAgent: string;
  rejected: RejectedWrite[];
}

/** Ids are cut short: enough to find the row, no more. */
export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : "-");

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : "-");
const ageSeconds = (ms: number | null, now: number) => (ms ? `${Math.round((now - ms) / 1000)}s` : "-");

/** One block of plain text to paste into WhatsApp. Holds no name, email or service number. */
export function diagnosticsText(d: DiagnosticsInfo, now = Date.now()): string {
  const lines = [
    `app: ${d.appVersion} / sw: ${d.workerVersion ?? "-"}${d.updateWaiting ? " (update waiting)" : ""}`,
    `user: ${shortId(d.userId)} ${d.role ?? "-"} ${d.unit ?? "-"} ${d.approval ?? "-"}`,
    `online: ${d.online ? "yes" : "no"}, last sync: ${iso(d.lastSync)}`,
    `queue: ${d.queueLength}, oldest: ${ageSeconds(d.oldestQueuedAt, now)}, tries: ${d.oldestQueuedTries ?? "-"}`,
    `push: ${d.pushPermission}, subscribed: ${d.pushSubscribed ? "yes" : "no"}, id: ${shortId(d.pushSubscriptionId)}`,
    `mode: ${d.standalone ? "home screen" : "browser"}`,
    `ua: ${d.userAgent}`,
    ...d.rejected.map((r) => `rejected: ${iso(r.at)} ${r.kind} ${r.target} ${r.code}`),
  ];
  return lines.join("\n");
}
