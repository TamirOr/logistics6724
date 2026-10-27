// Sets up the hosted Supabase project through its Management API, so the
// project can be run from GitHub Actions with no dashboard work or local
// terminal. Every command is safe to run again.
//
//   node scripts/supabase-admin.mjs configure      server config, push keys, email-code sign-in
//   node scripts/supabase-admin.mjs anon-key       prints the public anon key
//   node scripts/supabase-admin.mjs make-admin     promotes ADMIN_EMAIL (signed in once already)
//
// Environment: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, and for
// configure SITE_URL plus the optional SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS, SMTP_SENDER.
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
  };
  if (smtp) {
    Object.assign(settings, {
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

async function configureAuth({ api }, env) {
  const otpTemplate = await readFile(new URL("../supabase/templates/otp.html", import.meta.url), "utf8");
  const smtp = smtpFromEnv(env);
  await api("PATCH", "/config/auth", authSettings({ siteUrl: env.SITE_URL, otpTemplate, smtp }));
}

/** Runs every step even if one fails, then reports all failures together. */
async function configure(env) {
  if (!env.SITE_URL) throw new Error("SITE_URL is required");
  const project = client(env);
  const steps = { "server URLs": storeServerUrls, "VAPID keys": ensureVapidKeys, "auth settings": configureAuth };
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

async function anonKey(env) {
  const { api } = client(env);
  const keys = await api("GET", "/api-keys");
  const anon = keys.find((k) => k.name === "anon");
  if (!anon) throw new Error("no anon key found");
  process.stdout.write(anon.api_key);
}

async function makeAdmin(env) {
  const { sql } = client(env);
  const email = env.ADMIN_EMAIL?.trim();
  if (!email) throw new Error("ADMIN_EMAIL is required");
  await sql(`select promote_admin(${sqlLiteral(email)})`);
  console.log(`${email} is now an admin`);
}

const commands = { configure, "anon-key": anonKey, "make-admin": makeAdmin };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
