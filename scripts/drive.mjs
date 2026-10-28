// Encrypted backups in the Google Drive folder the archive already uses.
// Files are named backup-<target>-YYYY-MM-DD.tar.gz.age; 14 daily and 8
// weekly (Sunday) copies are kept. The OAuth client only sees files it
// created (drive.file scope), so other files in the folder are untouched.
//
//   node scripts/drive.mjs upload <file>         as today's backup (replaces a same-day one)
//   node scripts/drive.mjs download-latest <out> the newest backup
//   node scripts/drive.mjs prune                 deletes copies outside the retention
//
// Environment: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
// DRIVE_FOLDER_ID, BACKUP_TARGET (production or staging).
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const KEEP_DAILY = 14;
export const KEEP_WEEKLY = 8;

export const backupName = (target, date) => `backup-${target}-${date.toISOString().slice(0, 10)}.tar.gz.age`;

const backupDate = (target, name) => new RegExp(`^backup-${target}-(\\d{4}-\\d{2}-\\d{2})\\.tar\\.gz\\.age$`).exec(name)?.[1];

/** Names to delete: everything but the newest 14 and, of the rest, the newest 8 taken on a Sunday. */
export function backupsToDelete(target, names, daily = KEEP_DAILY, weekly = KEEP_WEEKLY) {
  const dated = names
    .map((name) => ({ name, date: backupDate(target, name) }))
    .filter((b) => b.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const keep = new Set(dated.slice(0, daily).map((b) => b.name));
  dated.filter((b) => !keep.has(b.name) && new Date(`${b.date}T00:00:00Z`).getUTCDay() === 0)
    .slice(0, weekly)
    .forEach((b) => keep.add(b.name));
  return dated.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

function settings(env) {
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "DRIVE_FOLDER_ID", "BACKUP_TARGET"];
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  return { folder: env.DRIVE_FOLDER_ID, target: env.BACKUP_TARGET };
}

async function token(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status}`);
  return (await res.json()).access_token;
}

async function call(auth, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${auth}`, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url.split("?")[0]}: ${res.status}`);
  return res;
}

async function listBackups(auth, folder, target) {
  const q = `'${folder}' in parents and name contains 'backup-${target}-' and trashed = false`;
  const res = await call(auth, `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=200`);
  return (await res.json()).files ?? [];
}

async function upload(env) {
  const file = process.argv[3];
  if (!file) throw new Error("usage: upload <file>");
  const { folder, target } = settings(env);
  const auth = await token(env);
  const name = backupName(target, new Date());
  const data = await readFile(file);
  const existing = (await listBackups(auth, folder, target)).find((f) => f.name === name);
  if (existing) {
    await call(auth, `${UPLOAD}/${existing.id}?uploadType=media`, { method: "PATCH", body: data });
  } else {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ name, parents: [folder] })], { type: "application/json" }));
    form.append("file", new Blob([data], { type: "application/octet-stream" }));
    await call(auth, `${UPLOAD}?uploadType=multipart`, { method: "POST", body: form });
  }
  console.log(`uploaded ${name} (${data.length} bytes)`);
}

async function downloadLatest(env) {
  const out = process.argv[3];
  if (!out) throw new Error("usage: download-latest <out>");
  const { folder, target } = settings(env);
  const auth = await token(env);
  const latest = (await listBackups(auth, folder, target)).sort((a, b) => b.name.localeCompare(a.name))[0];
  if (!latest) throw new Error(`no backup-${target}-* files in the folder`);
  const res = await call(auth, `${DRIVE}/${latest.id}?alt=media`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${latest.name}`);
}

async function prune(env) {
  const { folder, target } = settings(env);
  const auth = await token(env);
  const files = await listBackups(auth, folder, target);
  const doomed = new Set(backupsToDelete(target, files.map((f) => f.name)));
  for (const f of files.filter((f) => doomed.has(f.name))) await call(auth, `${DRIVE}/${f.id}`, { method: "DELETE" });
  console.log(`kept ${files.length - doomed.size}, deleted ${doomed.size}`);
}

const commands = { upload, "download-latest": downloadLatest, prune };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = commands[process.argv[2]];
  if (!command) {
    console.error(`usage: drive.mjs ${Object.keys(commands).join(" | ")}`);
    process.exit(2);
  }
  command(process.env).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
