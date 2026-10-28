import assert from "node:assert/strict";
import { test } from "node:test";
import { destructiveStatements } from "./migration-check.mjs";

test("finds drops, renames, type changes and truncates", () => {
  const sql = `
    drop table old_things;
    alter table users drop column nickname;
    alter table units rename to unit;
    alter table requests alter column quantity type bigint;
    truncate missing_queue;
    drop function keepalive();`;
  assert.equal(destructiveStatements(sql).length, 6);
});

test("leaves additive changes and comments alone", () => {
  const sql = `
    -- we used to drop table x here
    create table job_runs (id bigint);
    alter table push_subscriptions add column last_success_at timestamptz;
    drop trigger if exists t on requests;
    drop policy p on units;
    create index i on requests (company_id);`;
  assert.deepEqual(destructiveStatements(sql), []);
});
