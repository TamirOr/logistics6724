import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseNotes } from "./release-notes.mjs";

test("groups features, fixes and breaking changes", () => {
  const notes = releaseNotes([
    "feat(web): diagnostics screen",
    "fix(db): audit trigger skips archive deletes",
    "chore: bump deps",
    "Merge pull request #13 from x/y",
    "feat(db)!: drop keepalive()",
    "fix: typo",
  ]);
  assert.equal(notes, [
    "### Breaking changes",
    "- **db:** drop keepalive()",
    "",
    "### Features",
    "- **web:** diagnostics screen",
    "",
    "### Fixes",
    "- **db:** audit trigger skips archive deletes",
    "- typo",
    "",
  ].join("\n"));
});

test("says so when there is nothing user-facing", () => {
  assert.equal(releaseNotes(["chore: ci", "docs: runbook"]), "Maintenance only.\n");
});
