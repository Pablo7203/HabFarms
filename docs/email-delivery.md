# HabFarms transactional email delivery

## Current release gate

Professional delivery is **pending operator action**. Production currently uses `smtp.gmail.com`. Supabase warns that this is a personal-mail SMTP service and may impair transactional-email deliverability. The free `habfarms.vercel.app` hostname is owned by Vercel, so HabFarms cannot publish SPF, DKIM, or DMARC records for it.

Do not claim production readiness until every item in the verification checklist below has evidence.

## Target architecture

1. Obtain a domain whose DNS the HabFarms operator controls.
2. Create a dedicated sending subdomain, for example `auth.<owned-domain>`.
3. Connect that subdomain to a transactional provider. Resend is a straightforward option, but the operator may choose Postmark, Brevo, Amazon SES, or another reputable provider.
4. Publish the provider's exact SPF and DKIM records and a DMARC record for the owned domain. Do not invent record values and do not publish a second SPF record at the same hostname.
5. Configure Supabase custom SMTP using dashboard secrets, never repository variables. Use a sender such as `HabFarms <no-reply@auth.<owned-domain>>` only after the provider verifies it.
6. Disable click/open tracking for authentication messages so providers do not rewrite one-time links.

No monitored support or Reply-To mailbox has been supplied. Leave Reply-To unset until the operator provides and monitors one; do not imply that a `no-reply` address accepts support requests.

## Environment URLs

| Environment | Site URL | Approved callbacks |
| --- | --- | --- |
| Staging | `https://habfarms-staging.vercel.app` | `/auth/callback`, `/auth/callback?next=/reset-password` |
| Production | `https://habfarms.vercel.app` | `/auth/callback`, `/auth/callback?next=/reset-password` |

Apply and verify all changes in staging before copying them to production. The HTML source of truth is in `supabase/templates/`. Hosted projects require copying each subject and HTML body into Supabase Dashboard > Authentication > Email Templates; `config.toml` applies to local Supabase only.

## Template mapping

| Supabase template | Subject | Source file |
| --- | --- | --- |
| Confirm sign up | Confirm your HabFarms account | `confirmation.html` |
| Invite user | You are invited to HabFarms | `invite.html` |
| Reset password | Reset your HabFarms password | `recovery.html` |
| Magic link or OTP | Your HabFarms sign-in link | `magic-link.html` |
| Change email address | Confirm your new HabFarms email address | `email-change.html` |
| Reauthentication | Your HabFarms verification code | `reauthentication.html` |
| Password changed notification | Your HabFarms password was changed | `password-changed.html` |
| Email changed notification | Your HabFarms email address was changed | `email-changed.html` |

The confirmation, invitation, recovery, and email-change links send the token hash to the server callback. This supports cross-device use and avoids exposing a session in URL fragments. Keep the callback allow-list exact and preserve its safe relative `next` validation.

## Staging procedure

1. Verify the sending subdomain in the provider dashboard.
2. Confirm SPF and DKIM show verified and check the published DMARC record with a DNS lookup.
3. Enter provider SMTP host, port, username, password, sender name, and verified sender in the **staging** Supabase dashboard. Never paste credentials into source control or issue output.
4. Replace staging hosted templates from the version-controlled files and enable the two reviewed security notifications.
5. Confirm the staging Site URL and exact redirect allow-list shown above.
6. Trigger confirmation, password-reset, invitation (if used), email-change (if used), and security-notification messages with isolated accounts.
7. Deliver to at least Gmail and Outlook. Inspect original message headers and record: SPF `PASS`, DKIM `PASS`, DMARC `PASS`, From alignment, expected Return-Path, TLS, and absence of unexpected link rewriting.
8. Open every action on desktop and mobile, including a reset link on a device different from the one that requested it. Verify expiration and replay handling.
9. Inspect provider delivery, bounce, complaint, and suppression logs. Test a controlled invalid recipient and verify failures do not reveal provider details to users.
10. Repeat the approved configuration and tests in production.

## Production evidence checklist

- [ ] Owned sending domain and DNS control recorded
- [ ] Transactional provider selected and account secured with MFA
- [ ] Verified sender name and address recorded
- [ ] SPF pass with a single valid SPF policy at each hostname
- [ ] DKIM pass using the provider-issued selector
- [ ] DMARC pass and alignment confirmed from received headers
- [ ] Gmail inbox/header test passed
- [ ] Outlook inbox/header test passed
- [ ] Confirmation, recovery, invitation, and change-email actions tested as applicable
- [ ] Password/email security notifications received and reviewed
- [ ] Provider tracking disabled for auth messages
- [ ] Bounce, complaint, and suppression handling reviewed
- [ ] Secrets present only in Supabase/provider dashboards

Passing SPF/DKIM/DMARC improves authentication but cannot guarantee inbox placement or zero spam classification. Continue monitoring provider delivery signals after release.
