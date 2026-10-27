import assert from "node:assert/strict";
import { test } from "node:test";
import { authSettings, generateVapidKeys, sqlLiteral } from "./supabase-admin.mjs";

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

test("auth settings use 6-digit codes and add SMTP only when configured", () => {
  const base = authSettings({ siteUrl: "https://x.github.io/app/", otpTemplate: "{{ .Token }}", smtp: {} });
  assert.equal(base.mailer_otp_length, 6);
  assert.equal(base.mailer_templates_magic_link_content, "{{ .Token }}");
  assert.equal(base.smtp_host, undefined);

  const withSmtp = authSettings({
    siteUrl: "https://x.github.io/app/", otpTemplate: "", smtp: { host: "smtp.resend.com", user: "resend", pass: "k", sender: "a@b.c" },
  });
  assert.equal(withSmtp.smtp_host, "smtp.resend.com");
  assert.equal(withSmtp.smtp_port, "587");
});
