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

/** A SQL string literal. */
export const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** The auth settings for 6-digit email codes, with optional custom SMTP. */
export function authSettings({ siteUrl, otpTemplate, smtp }) {
  const settings = {
    site_url: siteUrl,
    uri_allow_list: siteUrl,
    mailer_autoconfirm: true,
    mailer_otp_length: 6,
    mailer_otp_exp: 600,
    mailer_subjects_magic_link: "קוד הכניסה שלך",
    mailer_templates_magic_link_content: otpTemplate,
    mailer_subjects_confirmation: "קוד הכניסה שלך",
    mailer_templates_confirmation_content: otpTemplate,
  };
  if (smtp.host) {
    Object.assign(settings, {
      smtp_host: smtp.host,
      smtp_port: smtp.port ?? "587",
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

async function configure(env) {
  const { ref, api, sql } = client(env);
  const siteUrl = env.SITE_URL;
  if (!siteUrl) throw new Error("SITE_URL is required");

  await sql(`
    insert into app_config (key, value) values
      ('functions_url', ${sqlLiteral(`https://${ref}.supabase.co/functions/v1`)}),
      ('site_url', ${sqlLiteral(siteUrl)})
    on conflict (key) do update set value = excluded.value`);

  // Keys are generated once. Replacing them would cut off every device
  // that already subscribed.
  const existing = await sql("select 1 from app_config where key = 'vapid_private_key'");
  if (!existing.length) {
    const { publicKey, privateKey } = generateVapidKeys();
    await sql(`
      insert into app_config (key, value, client_readable) values
        ('vapid_public_key', ${sqlLiteral(publicKey)}, true),
        ('vapid_private_key', ${sqlLiteral(privateKey)}, false)`);
    console.log("Generated VAPID keys");
  }

  const otpTemplate = await readFile(new URL("../supabase/templates/otp.html", import.meta.url), "utf8");
  const smtp = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, sender: env.SMTP_SENDER };
  await api("PATCH", "/config/auth", authSettings({ siteUrl, otpTemplate, smtp }));
  console.log(`Configured auth for ${siteUrl}${smtp.host ? " with custom SMTP" : ""}`);
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
    process.exit(1);
  });
}
