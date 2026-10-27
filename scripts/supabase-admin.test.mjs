import assert from "node:assert/strict";
import { test } from "node:test";
import { annotation, authSettings, generateVapidKeys, smtpFromEnv, sqlLiteral } from "./supabase-admin.mjs";

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
