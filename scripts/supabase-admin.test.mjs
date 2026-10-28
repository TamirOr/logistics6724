import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotation, authScaffold, authSettings, copyHeaders, copyRowCounts, formatHealth, formatStatus, generateVapidKeys, smtpFromEnv, sqlLiteral, STATUS_CHECKS,
} from "./supabase-admin.mjs";

// web-push rejects keys that are not exactly these sizes.
test("VAPID keys have the sizes Web Push expects", () => {
  for (let i = 0; i < 50; i++) {
    const { publicKey, privateKey } = generateVapidKeys();
    assert.equal(Buffer.from(publicKey, "base64url").length, 65);
    assert.equal(Buffer.from(privateKey, "base64url").length, 32);
  }
});

test("sqlLiteral escapes quotes", () => {
  assert.equal(sqlLiteral("o'brien@example.com"), "'o''brien@example.com'");
});

test("without SMTP, auth settings leave the email template alone", () => {
  // Supabase rejects template changes on the free plan's default sender.
  const base = authSettings({ siteUrl: "https://x.github.io/app/", otpTemplate: "{{ .Token }}", smtp: null });
  assert.equal(base.mailer_otp_length, 6);
  assert.equal(base.mailer_templates_magic_link_content, undefined);
  assert.equal(base.smtp_host, undefined);
  assert.equal(base.rate_limit_email_sent, undefined);
});

test("auth settings always limit code requests and checks per IP", () => {
  const base = authSettings({ siteUrl: "https://x.github.io/app/", otpTemplate: "", smtp: null });
  assert.equal(base.rate_limit_otp, 30);
  assert.equal(base.rate_limit_verify, 30);
});

test("with SMTP, auth settings install the code template and the sender", () => {
  const withSmtp = authSettings({
    siteUrl: "https://x.github.io/app/", otpTemplate: "{{ .Token }}",
    smtp: { host: "smtp.gmail.com", port: "587", user: "a@gmail.com", pass: "k", sender: "a@gmail.com" },
  });
  assert.equal(withSmtp.mailer_templates_magic_link_content, "{{ .Token }}");
  assert.equal(withSmtp.mailer_templates_confirmation_content, "{{ .Token }}");
  assert.equal(withSmtp.smtp_host, "smtp.gmail.com");
  assert.equal(withSmtp.smtp_port, "587");
  assert.equal(withSmtp.rate_limit_email_sent, 60);
});

test("annotation keeps a multi-line error on one workflow command line", () => {
  assert.equal(annotation("a: 50%\nb: 400"), "a: 50%25%0Ab: 400");
});

test("smtpFromEnv is null without SMTP_HOST, including an empty secret", () => {
  assert.equal(smtpFromEnv({}), null);
  assert.equal(smtpFromEnv({ SMTP_HOST: "", SMTP_USER: "a@gmail.com" }), null);
});

test("smtpFromEnv trims values, strips app password spaces and fills defaults", () => {
  const smtp = smtpFromEnv({
    SMTP_HOST: " smtp.gmail.com\n", SMTP_PORT: "", SMTP_USER: "a@gmail.com ", SMTP_PASS: "abcd efgh ijkl mnop", SMTP_SENDER: "",
  });
  assert.deepEqual(smtp, { host: "smtp.gmail.com", port: "587", user: "a@gmail.com", pass: "abcdefghijklmnop", sender: "a@gmail.com" });
});

test("smtpFromEnv names the secret to fix", () => {
  const base = { SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@gmail.com", SMTP_PASS: "x" };
  assert.throws(() => smtpFromEnv({ ...base, SMTP_SENDER: '"Logistics" <a@gmail.com>' }), /SMTP_SENDER/);
  assert.throws(() => smtpFromEnv({ ...base, SMTP_USER: "", SMTP_SENDER: "a@gmail.com" }), /SMTP_USER or SMTP_PASS/);
  assert.throws(() => smtpFromEnv({ ...base, SMTP_USER: "brevo-login", SMTP_SENDER: "" }), /SMTP_SENDER/);
});

test("formatStatus shows rows, empty checks and errors", () => {
  const report = formatStatus([
    { title: "Push devices", rows: [{ devices: 2, users: 1 }] },
    { title: "Send errors", rows: [] },
    { title: "Scheduled jobs", error: 'relation "cron.job" does not exist' },
  ]);
  assert.equal(report, [
    "Push devices:\n  devices=2, users=1",
    "Send errors: none",
    'Scheduled jobs: unavailable (relation "cron.job" does not exist)',
  ].join("\n"));
});

test("status checks never select personal or secret columns", () => {
  // The report is posted on a public repository's run page.
  for (const [, query] of STATUS_CHECKS) {
    assert.doesNotMatch(query, /\b(email|first_name|last_name|service_number|endpoint|p256dh|auth|value|command)\b/i);
  }
});

test("formatHealth prints pass or fail, value and limit per check", () => {
  const lines = formatHealth({
    ok: false,
    checks: [
      { name: "db_size_mb", value: 12.5, max: 400, ok: true },
      { name: "backup_last_ok_hours", value: null, max: 26, ok: true },
      { name: "outbox_oldest_unsent_minutes", value: 31, max: 10, ok: false },
    ],
  });
  assert.equal(lines, [
    "PASS db_size_mb = 12.5 (max 400)",
    "PASS backup_last_ok_hours = - (max 26)",
    "FAIL outbox_oldest_unsent_minutes = 31 (max 10)",
  ].join("\n"));
});

test("copyRowCounts counts the rows of each COPY block", () => {
  const dump = [
    "SET statement_timeout = 0;",
    'COPY auth.users (id, email) FROM stdin;',
    "1\ta@x.il",
    "2\tb@x.il",
    "\\.",
    "",
    'COPY public.units (id, name) FROM stdin;',
    "\\.",
    'COPY public."audit_log" (id) FROM stdin;',
    "7",
    "\\.",
  ].join("\n");
  assert.deepEqual([...copyRowCounts(dump)], [["auth.users", 2], ["public.units", 0], ['public."audit_log"', 1]]);
});

test("copyHeaders lists each COPY block's table and columns", () => {
  const dump = ["COPY auth.users (id, email, phone) FROM stdin;", "\\.", 'COPY public."units" (id) FROM stdin;', "\\."].join("\n");
  assert.deepEqual(copyHeaders(dump), [
    { table: "auth.users", columns: ["id", "email", "phone"] },
    { table: 'public."units"', columns: ["id"] },
  ]);
});

test("authScaffold adds auth tables and columns as text, and leaves public alone", () => {
  const dump = ["COPY auth.users (id, phone) FROM stdin;", "\\.", "COPY public.units (id) FROM stdin;", "\\."].join("\n");
  assert.equal(authScaffold(dump), [
    "create table if not exists auth.users ();",
    "alter table auth.users add column if not exists id text;",
    "alter table auth.users add column if not exists phone text;",
  ].join("\n"));
});
