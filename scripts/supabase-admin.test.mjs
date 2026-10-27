import assert from "node:assert/strict";
import { test } from "node:test";
import { annotation, authSettings, generateVapidKeys, sqlLiteral } from "./supabase-admin.mjs";

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
  const base = authSettings({ siteUrl: "https://x.github.io/app/", otpTemplate: "{{ .Token }}", smtp: {} });
  assert.equal(base.mailer_otp_length, 6);
  assert.equal(base.mailer_templates_magic_link_content, undefined);
  assert.equal(base.smtp_host, undefined);
});

test("with SMTP, auth settings install the code template and the sender", () => {
  const withSmtp = authSettings({
    siteUrl: "https://x.github.io/app/", otpTemplate: "{{ .Token }}",
    smtp: { host: "smtp.gmail.com", user: "a@gmail.com", pass: "k", sender: "a@gmail.com" },
  });
  assert.equal(withSmtp.mailer_templates_magic_link_content, "{{ .Token }}");
  assert.equal(withSmtp.mailer_templates_confirmation_content, "{{ .Token }}");
  assert.equal(withSmtp.smtp_host, "smtp.gmail.com");
  assert.equal(withSmtp.smtp_port, "587");
});

test("annotation keeps a multi-line error on one workflow command line", () => {
  assert.equal(annotation("a: 50%\nb: 400"), "a: 50%25%0Ab: 400");
});
