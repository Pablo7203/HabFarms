# HabFarms user management

Only an active farm Admin can manage users. Open **Settings → Users** to view active members and invitation history.

## Invite and accept

1. Select **Invite User**.
2. Enter the recipient's email and choose Admin, Manager, or Worker.
3. Select **Send Invitation**. The invitation appears as **Invitation Pending**.
4. A brand-new HabFarms user opens the secure email, chooses their own password, and accepts the farm invitation.
5. An existing HabFarms user signs in with their existing password and accepts the additional farm invitation without changing credentials.
6. Acceptance creates or reactivates only the membership described by the pending invitation and changes its status to **Accepted**.

Each pending invitation is accepted separately. HabFarms derives the farm, role, user identity, and verified email from the authenticated session and authoritative invitation row; the browser cannot supply those values as membership authority.

## Pending invitations

- **Resend** rotates only a disposable, unaccepted Auth invitation identity and sends a new secure email. It does not create a second pending invitation or membership.
- **Revoke** marks the invitation revoked and preserves its audit history. Old email links cannot create membership after revocation.
- A duplicate pending invitation or an invitation for an existing active member of the same farm is rejected.

## Active members

An Admin may change a permitted role, deactivate farm access, or reactivate an inactive membership. Deactivation does not delete the global Auth account, other-farm memberships, transactions, or audit history. Authorization is checked again on protected requests, so an active Auth session does not bypass an inactive membership.

HabFarms never permits demotion or deactivation that would leave a farm without an active Admin. Assign another Admin first.

## Roles

- **Admin:** farm user provisioning and membership administration plus the existing business permissions.
- **Manager:** the existing supervisory/business contract; no user provisioning or membership administration.
- **Worker:** operational contract only; restricted financial, commercial, pricing, opening-stock, reporting, and user-management areas remain unavailable.

## Troubleshooting

Use **Resend** only after the rate-limit interval. If an invitation is revoked or no longer pending, create a new invitation. Never send passwords or edit membership directly in Supabase Studio. Use the audit page to review invitation creation, resend, acceptance, revocation, role change, deactivation, and reactivation events.
