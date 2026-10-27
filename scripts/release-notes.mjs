// Release notes from Conventional Commit subjects, one per stdin line.
//   git log --format=%s v1.0.0..v1.1.0 | node scripts/release-notes.mjs
import { pathToFileURL } from "node:url";

const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
];

/** Markdown with a section per change type; merge commits and chores are left out. */
export function releaseNotes(subjects) {
  const parsed = subjects
    .map((s) => /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(s.trim()))
    .filter(Boolean)
    .map(([, type, scope, breaking, text]) => ({ type, scope, breaking: !!breaking, text }));
  const line = (c) => `- ${c.scope ? `**${c.scope}:** ` : ""}${c.text}`;
  const out = [];
  const breaking = parsed.filter((c) => c.breaking);
  if (breaking.length) out.push("### Breaking changes", ...breaking.map(line), "");
  for (const [type, title] of SECTIONS) {
    const commits = parsed.filter((c) => c.type === type && !c.breaking);
    if (commits.length) out.push(`### ${title}`, ...commits.map(line), "");
  }
  return out.length ? out.join("\n").trimEnd() + "\n" : "Maintenance only.\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => process.stdout.write(releaseNotes(input.split("\n").filter(Boolean))));
}
