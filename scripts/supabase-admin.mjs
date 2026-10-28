// Sets up the hosted Supabase project through its Management API, so the
// project can be run from GitHub Actions with no dashboard work or local
// terminal. Every command is safe to run again.
//
//   node scripts/supabase-admin.mjs configure      server config, push keys, email-code sign-in
//   node scripts/supabase-admin.mjs anon-key       prints the public anon key
//   node scripts/supabase-admin.mjs make-admin     promotes ADMIN_EMAIL (signed in once already)
//   node scripts/supabase-admin.mjs status         reports scheduled jobs, push devices and send errors
//   node scripts/supabase-admin.mjs health         fails when health_report() is red (counts only, logs are public)
//   node scripts/supabase-admin.mjs record-backup  records a successful backup in job_runs
//   node scripts/supabase-admin.mjs rotate-cron-secret   replaces the secret pg_cron and the functions share
//   node scripts/supabase-admin.mjs seed-staging   loads fake units and catalog (staging only)
//   node scripts/supabase-admin.mjs pg -- <tool> <args>  runs pg_dump or psql against the project
//   node scripts/supabase-admin.mjs backup-manifest       prints what a backup holds (no data)
//   node scripts/supabase-admin.mjs restore-scaffold <dump> auth tables the drill database needs for a dump
//   node scripts/supabase-admin.mjs verify-restore <dump> compares the drill database's row counts with a dump
//
// Environment: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, and for
// configure SITE_URL plus the optional SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS, SMTP_SENDER.
import { spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API = "https://api.supabase.com/v1";

/** A VAPID key pair for Web Push, base64url encoded as push services expect. */
export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  // The raw private key can come back shorter than 32 bytes; pad it.
  const privateKey = Buffer.from(ecdh.getPrivateKey("hex").padStart(64, "0"), "hex");
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: privateKey.toString("base64url"),
  };
}

/** Escapes a message for a GitHub Actions workflow command. */
export const annotation = (message) =>
  message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/** A SQL string literal. */
export const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const EMAIL = /^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/;

/**
 * SMTP settings from the SMTP_* secrets, or null when SMTP_HOST is not set.
 * A missing secret reaches the workflow as an empty string, and pasted
 * values can carry spaces, so values are trimmed and checked here with a
 * message that names the secret to fix.
 */
export function smtpFromEnv(env) {
  const value = (name) => (env[name] ?? "").trim();
  const host = value("SMTP_HOST");
  if (!host) return null;

  const user = value("SMTP_USER");
  // App passwords are shown in groups of four with spaces; none belong in it.
  const pass = value("SMTP_PASS").replace(/\s+/g, "");
  const sender = value("SMTP_SENDER") || user;
  if (!user || !pass) throw new Error("SMTP_HOST is set, but SMTP_USER or SMTP_PASS is empty");
  if (!EMAIL.test(sender)) {
    throw new Error("SMTP_SENDER must be a plain email address such as name@gmail.com (no spaces, quotes or name)");
  }
  return { host, port: value("SMTP_PORT") || "587", user, pass, sender };
}

/**
 * Auth settings for email sign-in. The 6-digit code needs our email
 * template, and Supabase allows custom templates on the free plan only with
 * a custom SMTP provider. Without one, emails keep Supabase's default
 * template, which carries a sign-in link instead of the code.
 */
export function authSettings({ siteUrl, otpTemplate, smtp = null }) {
  const settings = {
    site_url: siteUrl,
    uri_allow_list: siteUrl,
    mailer_autoconfirm: true,
    mailer_otp_length: 6,
    mailer_otp_exp: 600,
    // Sign-in abuse: per IP, per 5 minutes. Generous for 100 users, some
    // of them behind one carrier address; low enough to stop guessing.
    rate_limit_otp: 30,
    rate_limit_verify: 30,
    // Admin rights need a TOTP second factor (is_admin() checks aal2).
    // Included on the free plan.
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
  };
  if (smtp) {
    Object.assign(settings, {
      // Emails per hour for the whole project. Settable only with a custom sender.
      rate_limit_email_sent: 60,
      mailer_subjects_magic_link: "קוד הכניסה שלך",
      mailer_templates_magic_link_content: otpTemplate,
      mailer_subjects_confirmation: "קוד הכניסה שלך",
      mailer_templates_confirmation_content: otpTemplate,
      smtp_host: smtp.host,
      smtp_port: smtp.port,
      smtp_user: smtp.user,
      smtp_pass: smtp.pass,
      smtp_admin_email: smtp.sender,
      smtp_sender_name: "לוגיסטיקה גדודית",
    });
  }
  return settings;
}

function client(env) {
  const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = env;
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");

  async function api(method, path, body) {
    const res = await fetch(`${API}/projects/${ref}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return { ref, api, sql: (query) => api("POST", "/database/query", { query }) };
}

async function storeServerUrls({ ref, sql }, env) {
  await sql(`
    insert into app_config (key, value) values
      ('functions_url', ${sqlLiteral(`https://${ref}.supabase.co/functions/v1`)}),
      ('site_url', ${sqlLiteral(env.SITE_URL)})
    on conflict (key) do update set value = excluded.value`);
}

// Keys are generated once. Replacing them would cut off every device that
// already subscribed.
async function ensureVapidKeys({ sql }) {
  const existing = await sql("select 1 from app_config where key = 'vapid_private_key'");
  if (existing.length) return;
  const { publicKey, privateKey } = generateVapidKeys();
  await sql(`
    insert into app_config (key, value, client_readable) values
      ('vapid_public_key', ${sqlLiteral(publicKey)}, true),
      ('vapid_private_key', ${sqlLiteral(privateKey)}, false)`);
  console.log("Generated VAPID keys");
}

// pg_cron reads the cron secret from app_config; the functions check it
// against their CRON_SECRET secret before touching the database. This keeps
// the two equal.
async function syncCronSecret({ api, sql }) {
  const [row] = await sql("select value from app_config where key = 'cron_secret'");
  if (!row) throw new Error("app_config has no cron_secret");
  await api("POST", "/secrets", [{ name: "CRON_SECRET", value: row.value }]);
}

async function configureAuth({ api }, env) {
  const otpTemplate = await readFile(new URL("../supabase/templates/otp.html", import.meta.url), "utf8");
  const smtp = smtpFromEnv(env);
  await api("PATCH", "/config/auth", authSettings({ siteUrl: env.SITE_URL, otpTemplate, smtp }));
}

/** Runs every step even if one fails, then reports all failures together. */
async function configure(env) {
  if (!env.SITE_URL) throw new Error("SITE_URL is required");
  const project = client(env);
  const steps = {
    "server URLs": storeServerUrls, "VAPID keys": ensureVapidKeys, "cron secret": syncCronSecret, "auth settings": configureAuth,
  };
  const failures = [];
  for (const [name, step] of Object.entries(steps)) {
    try {
      await step(project, env);
      console.log(`ok: ${name}`);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

async function fetchAnonKey({ api }) {
  const keys = await api("GET", "/api-keys");
  const anon = keys.find((k) => k.name === "anon");
  if (!anon) throw new Error("no anon key found");
  return anon.api_key;
}

async function anonKey(env) {
  process.stdout.write(await fetchAnonKey(client(env)));
}

async function makeAdmin(env) {
  const { sql } = client(env);
  const email = env.ADMIN_EMAIL?.trim();
  if (!email) throw new Error("ADMIN_EMAIL is required");
  await sql(`select promote_admin(${sqlLiteral(email)})`);
  // Not the address: the run page is public.
  console.log("admin promoted");
}

// What the status report checks. The repository is public and so are its
// workflow annotations: these queries return counts and error text only,
// never emails, names or secrets.
export const STATUS_CHECKS = [
  ["Extensions", "select extname from pg_extension where extname in ('pg_cron', 'pg_net') order by 1"],
  ["Server config keys", `select key from app_config
    where key in ('functions_url', 'site_url', 'cron_secret', 'vapid_public_key', 'vapid_private_key') order by 1`],
  ["Scheduled jobs", "select jobname, schedule, active from cron.job order by jobname"],
  ["Recent job runs", `select j.jobname, d.status, left(d.return_message, 120) as message, d.start_time
    from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 5`],
  ["Recent function calls", `select status_code, left(coalesce(error_msg, content::text), 160) as detail, created
    from net._http_response order by created desc limit 5`],
  ["Recent runs", "select job, ok, finished_at from job_runs order by finished_at desc limit 5"],
  ["Push devices", "select count(*) as devices, count(distinct user_id) as users from push_subscriptions"],
  ["Notifications", `select kind, count(*) filter (where sent_at is not null) as sent,
    count(*) filter (where sent_at is null) as unsent, max(attempts) as max_attempts
    from notification_outbox group by kind order by kind`],
  ["Send errors", `select left(last_error, 160) as error, count(*) from notification_outbox
    where last_error is not null group by 1 order by 2 desc limit 3`],
];

/** One readable block per check: its rows as "key=value" lines, or its error. */
export function formatStatus(results) {
  return results.map(({ title, rows, error }) => {
    if (error) return `${title}: unavailable (${error})`;
    if (!rows.length) return `${title}: none`;
    const lines = rows.map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(", "));
    return `${title}:\n  ${lines.join("\n  ")}`;
  }).join("\n");
}

/** Reports what push notifications depend on, as a notice on the run page. */
async function status(env) {
  const { sql } = client(env);
  const results = [];
  for (const [title, query] of STATUS_CHECKS) {
    try {
      results.push({ title, rows: await sql(query) });
    } catch (e) {
      // A missing extension makes its tables missing; that is the finding.
      results.push({ title, error: e.message.slice(0, 160) });
    }
  }
  const report = formatStatus(results);
  console.log(report);
  if (env.GITHUB_ACTIONS) console.log(`::notice title=Project status::${annotation(report)}`);
}

/** One line per check: PASS or FAIL, its value and its limit. Numbers only. */
export function formatHealth(report) {
  const number = (v) => (v === null || v === undefined ? "-" : String(v));
  return report.checks
    .map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name} = ${number(c.value)} (max ${number(c.max)})`)
    .join("\n");
}

/**
 * The scheduled health check. Calls the anonymous health RPC the way the
 * uptime monitor does (which also keeps a free project from pausing), then
 * health_report() through the Management API. Fails the run when red, and
 * GitHub emails the failure.
 */
async function health(env) {
  const project = client(env);
  const anon = await fetchAnonKey(project);
  const res = await fetch(`https://${project.ref}.supabase.co/rest/v1/rpc/health`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`rpc/health answered ${res.status}: the API is down or the project is paused`);

  const [{ health_report: report }] = await project.sql("select health_report()");
  const lines = formatHealth(report);
  console.log(lines);
  if (env.GITHUB_ACTIONS) console.log(`::notice title=Health (${env.HEALTH_TARGET ?? "project"})::${annotation(lines)}`);
  if (!report.ok) {
    const failing = report.checks.filter((c) => !c.ok).map((c) => c.name).join(", ");
    throw new Error(`unhealthy: ${failing}. See docs/runbook.md`);
  }
  await checkPrivileges(project);
}

/**
 * The live privilege check: the same privilege_drift() the SQL tests
 * assert, run on the hosted project, where a dashboard edit or a platform
 * default could grant what the migrations never did. Function and table
 * names only.
 */
async function checkPrivileges({ sql }) {
  const drift = (await sql("select privilege_drift() as problem")).map((r) => r.problem);
  if (drift.length) throw new Error(`privilege drift (docs/runbook.md):\n${drift.join("\n")}`);
  console.log("PASS privilege_drift = 0");
}

async function recordBackup(env) {
  const startedAt = new Date(env.BACKUP_STARTED_AT);
  const bytes = Number(env.BACKUP_BYTES);
  if (Number.isNaN(startedAt.getTime()) || !Number.isInteger(bytes)) throw new Error("BACKUP_STARTED_AT and BACKUP_BYTES are required");
  await client(env).sql(`insert into job_runs (job, started_at, ok, summary)
    values ('backup', ${sqlLiteral(startedAt.toISOString())}, true, jsonb_build_object('bytes', ${bytes}))`);
}

// pg_cron and wake_dispatcher read the secret from app_config when they
// run; the functions get the new value as their CRON_SECRET secret.
async function rotateCronSecret(env) {
  const project = client(env);
  await project.sql(`update app_config
    set value = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where key = 'cron_secret'`);
  await syncCronSecret(project);
  console.log("cron secret rotated");
}

async function seedStaging(env) {
  if (env.DEPLOY_TARGET !== "staging") throw new Error("seed-staging runs only with DEPLOY_TARGET=staging");
  const seed = await readFile(new URL("../supabase/seed/staging.sql", import.meta.url), "utf8");
  await client(env).sql(seed);
  console.log("staging seeded");
}

/**
 * libpq settings for the project's session pooler. GitHub runners have no
 * IPv6, and the direct database host is IPv6-only on the free plan.
 */
async function connectionEnv({ api }, env) {
  if (!env.SUPABASE_DB_PASSWORD) throw new Error("SUPABASE_DB_PASSWORD is required");
  const poolers = await api("GET", "/config/database/pooler");
  const pooler = poolers.find((p) => p.database_type === "PRIMARY") ?? poolers[0];
  if (!pooler) throw new Error("no connection pooler found for the project");
  return { PGHOST: pooler.db_host, PGPORT: "5432", PGUSER: pooler.db_user, PGDATABASE: pooler.db_name,
    PGPASSWORD: env.SUPABASE_DB_PASSWORD, PGSSLMODE: "require" };
}

/** Runs pg_dump or psql with the connection in its environment, so the password never reaches a command line or log. */
async function pg(env) {
  const [tool, ...args] = process.argv.slice(process.argv.indexOf("--") + 1);
  if (!["pg_dump", "psql"].includes(tool)) throw new Error("usage: pg -- pg_dump|psql <args>");
  const result = spawnSync(tool, args, { stdio: "inherit", env: { ...process.env, ...(await connectionEnv(client(env), env)) } });
  if (result.status !== 0) throw new Error(`${tool} exited with ${result.status ?? result.signal}`);
}

/** Which schema version a backup belongs to: restore it onto migrations up to this one. */
async function backupManifest(env) {
  const [{ version }] = await client(env).sql("select max(version) as version from supabase_migrations.schema_migrations");
  process.stdout.write(JSON.stringify({ created_at: new Date().toISOString(), migration: version, target: env.DEPLOY_TARGET }));
}

/** Each COPY block's table and column list in a pg_dump data file, in dump order. */
export function copyHeaders(dump) {
  return [...dump.matchAll(/^COPY ([\w."]+) \(([^)]*)\) FROM stdin;$/gm)].map(([, table, columns]) => ({
    table,
    columns: columns.split(",").map((c) => c.trim()),
  }));
}

/** Rows per table in a pg_dump data file (COPY format). */
export function copyRowCounts(dump) {
  const counts = new Map();
  let table = null;
  for (const line of dump.split("\n")) {
    if (table === null) {
      const copy = /^COPY ([\w."]+) /.exec(line);
      if (copy) {
        table = copy[1];
        counts.set(table, 0);
      }
    } else if (line === "\\.") {
      table = null;
    } else {
      counts.set(table, counts.get(table) + 1);
    }
  }
  return counts;
}

/**
 * The restore drill loads the backup into a throwaway Postgres built from
 * the migrations and the test stub of the auth schema. The stub has a few
 * auth columns; Supabase has many more. This adds every auth table and
 * column the dump holds, as text, so its rows load and can be counted.
 * The public schema is restored into its real tables and types.
 */
export function authScaffold(dump) {
  return copyHeaders(dump)
    .filter(({ table }) => table.startsWith("auth."))
    .flatMap(({ table, columns }) => [
      `create table if not exists ${table} ();`,
      ...columns.map((c) => `alter table ${table} add column if not exists ${c} text;`),
    ])
    .join("\n");
}

/** Prints the SQL that lets the dump's auth rows load into the drill database. */
async function restoreScaffold() {
  const file = process.argv[3];
  if (!file) throw new Error("usage: restore-scaffold <data.sql>");
  process.stdout.write(authScaffold(await readFile(file, "utf8")));
}

/**
 * After a restore drill: every table holds as many rows as the dump.
 * Counts the drill database named by the PG* environment, never a project.
 * Prints counts only.
 */
async function verifyRestore() {
  const file = process.argv[3];
  if (!file) throw new Error("usage: verify-restore <data.sql>");
  const expected = copyRowCounts(await readFile(file, "utf8"));
  const mismatches = [];
  for (const [table, rows] of expected) {
    const result = spawnSync("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", `select count(*) from ${table}`], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`counting ${table}: ${result.stderr.trim()}`);
    const count = Number(result.stdout.trim());
    console.log(`${count === rows ? "ok  " : "DIFF"} ${table}: ${count} of ${rows}`);
    if (count !== rows) mismatches.push(table);
  }
  if (mismatches.length) throw new Error(`row counts differ: ${mismatches.join(", ")}`);
}

const commands = {
  configure, "anon-key": anonKey, "make-admin": makeAdmin, status, health,
  "record-backup": recordBackup, "rotate-cron-secret": rotateCronSecret, "seed-staging": seedStaging,
  pg, "backup-manifest": backupManifest, "restore-scaffold": restoreScaffold, "verify-restore": verifyRestore,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = commands[process.argv[2]];
  if (!command) {
    console.error(`usage: supabase-admin.mjs ${Object.keys(commands).join(" | ")}`);
    process.exit(2);
  }
  command(process.env).catch((e) => {
    console.error(e.message);
    // Also as a GitHub annotation, which shows on the run page without
    // opening the log.
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=supabase-admin ${process.argv[2]}::${annotation(e.message)}`);
    process.exit(1);
  });
}
