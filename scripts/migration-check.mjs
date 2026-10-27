// CI: a pull request that adds a destructive migration (drop, rename, column
// type change, truncate) must carry the db-breaking label. Phones keep
// running the previous build until their service worker updates, so such a
// change needs expand-then-contract and a fresh backup before db push.
//
//   node scripts/migration-check.mjs <labels, comma separated> <migration files...>
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const BREAKING_LABEL = "db-breaking";

const DESTRUCTIVE = [
  /\bdrop\s+(table|column|type|schema|view|materialized\s+view|function)\b/i,
  /\brename\s+(to|column)\b/i,
  /\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/i,
  /\btruncate\b/i,
];

/** The destructive statements in a migration, comments ignored. */
export function destructiveStatements(sql) {
  const code = sql.replace(/--.*$/gm, "");
  return code.split(";").map((s) => s.trim().replace(/\s+/g, " ")).filter((s) => DESTRUCTIVE.some((re) => re.test(s)));
}

async function main([labels = "", ...files]) {
  const labelled = labels.split(",").map((l) => l.trim()).includes(BREAKING_LABEL);
  let found = 0;
  for (const file of files) {
    for (const statement of destructiveStatements(await readFile(file, "utf8"))) {
      found++;
      console.log(`${file}: ${statement.slice(0, 120)}`);
    }
  }
  if (found && !labelled) {
    console.log(`::error title=Destructive migration::Add the "${BREAKING_LABEL}" label after checking the change is backward compatible with the previous web build (see docs/runbook.md).`);
    process.exit(1);
  }
  console.log(found ? `${found} destructive statement(s), labelled ${BREAKING_LABEL}` : "no destructive statements");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
