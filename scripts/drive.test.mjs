import assert from "node:assert/strict";
import { test } from "node:test";
import { backupName, backupsToDelete } from "./drive.mjs";

const daysBack = (n, from = Date.UTC(2026, 9, 27)) => backupName("production", new Date(from - n * 86_400_000));

test("backup names carry the target and the UTC date", () => {
  assert.equal(backupName("production", new Date("2026-10-27T01:37:00Z")), "backup-production-2026-10-27.tar.gz.age");
});

test("keeps the newest 14 daily copies and 8 weekly Sunday copies", () => {
  const names = Array.from({ length: 120 }, (_, i) => daysBack(i));
  const deleted = new Set(backupsToDelete("production", names));
  const kept = names.filter((n) => !deleted.has(n));
  assert.equal(kept.length, 22);
  assert.deepEqual(kept.slice(0, 14), names.slice(0, 14));
  for (const name of kept.slice(14)) {
    assert.equal(new Date(`${name.slice(18, 28)}T00:00:00Z`).getUTCDay(), 0, `${name} is a Sunday`);
  }
});

test("never touches other targets or other files", () => {
  const names = [...Array.from({ length: 30 }, (_, i) => daysBack(i)), "backup-staging-2020-01-01.tar.gz.age", "logistics-2026-01.xlsx"];
  const deleted = backupsToDelete("production", names);
  assert.ok(!deleted.includes("backup-staging-2020-01-01.tar.gz.age"));
  assert.ok(!deleted.includes("logistics-2026-01.xlsx"));
});

test("deletes nothing while there are few copies", () => {
  assert.deepEqual(backupsToDelete("production", [daysBack(0), daysBack(1)]), []);
});
