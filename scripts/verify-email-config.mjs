import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const templates = {
  confirmation: "confirmation.html",
  invite: "invite.html",
  recovery: "recovery.html",
  magic_link: "magic-link.html",
  email_change: "email-change.html",
  reauthentication: "reauthentication.html",
  password_changed: "password-changed.html",
  email_changed: "email-changed.html",
};
let passed = 0;

function check(condition, description) {
  assert.ok(condition, description);
  passed += 1;
  console.log(`PASS ${description}`);
}

const config = await readFile(path.join(root, "supabase/config.toml"), "utf8");
const callback = await readFile(path.join(root, "src/app/auth/callback/route.ts"), "utf8");
const authActions = await readFile(path.join(root, "src/app/actions/auth.ts"), "utf8");
const envExample = await readFile(path.join(root, ".env.example"), "utf8");
const runbook = await readFile(path.join(root, "docs/email-delivery.md"), "utf8");

for (const [type, filename] of Object.entries(templates)) {
  const html = await readFile(path.join(root, "supabase/templates", filename), "utf8");
  check(html.includes("HabFarms"), `${filename} uses HabFarms branding`);
  check(/max-width:600px/.test(html), `${filename} uses a conservative responsive width`);
  check(!/(localhost|127\.0\.0\.1)/i.test(html), `${filename} contains no local URL`);
  check(!/(api[_-]?key|private[_-]?key|smtp[_-]?pass|password\s*=)/i.test(html), `${filename} contains no credential-like value`);
  const configType = ["password_changed", "email_changed"].includes(type)
    ? `auth.email.notification.${type}`
    : `auth.email.template.${type}`;
  check(config.includes(`[${configType}]`) && config.includes(`content_path = "./supabase/templates/${filename}"`), `${filename} is referenced by config.toml`);
}

const recovery = await readFile(path.join(root, "supabase/templates/recovery.html"), "utf8");
check(recovery.includes("/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password"), "recovery uses the server token-hash callback and reset destination");
check(callback.includes('new Set<EmailOtpType>(["email", "recovery", "invite", "email_change"])'), "callback explicitly allows reviewed email OTP types");
check(callback.includes('requested?.startsWith("/")') && callback.includes('!requested.startsWith("//")') && callback.includes('!requested.includes("\\\\")'), "callback rejects unsafe next destinations");
check(authActions.includes("If an account exists, a reset link has been sent."), "password-reset response does not disclose account existence");
check(!/(smtp|sendgrid|resend|postmark|mailgun|ses).*=/i.test(envExample), ".env.example does not solicit SMTP credentials");
check(runbook.includes("SPF") && runbook.includes("DKIM") && runbook.includes("DMARC"), "runbook covers sender authentication");
check(runbook.includes("Gmail") && runbook.includes("Outlook") && runbook.includes("headers"), "runbook requires real mailbox and header tests");
check(runbook.includes("smtp.gmail.com") && runbook.includes("pending operator action"), "runbook records the current Gmail SMTP blocker without claiming completion");

console.log(`\nEmail configuration source verification: ${passed}/${passed} PASS`);
