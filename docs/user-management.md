# Farm user management

Only an active farm Admin can manage farm users. Manager and Worker accounts cannot invite, resend, revoke, change roles, or deactivate members.

## Invitation lifecycle

1. Open **Settings → Users** and choose **Invite User**.
2. Enter the recipient's email and choose Admin, Manager, or Worker.
3. HabFarms stores one normalized pending invitation and sends the Supabase Auth invitation through a server-only operation.
4. The recipient opens the HabFarms email, establishes a verified Auth session, chooses a password, and accepts the matching invitation.
5. Acceptance atomically activates the correct farm membership and role and changes the invitation from Pending to Accepted.

An existing Auth user signs in normally and can accept pending invitations addressed to their verified email. Their existing memberships remain unchanged. The application never creates a second Auth identity intentionally.

## Administration and safety

- **Resend** reuses the same logical pending invitation and is limited to once per minute.
- **Revoke** records who revoked the invitation and prevents any old email link from granting farm membership.
- Role changes take effect on the next authorization check.
- Deactivation removes farm access without deleting the global Auth identity or historical records.
- Reactivation is supported.
- The last active Admin cannot be demoted or deactivated.
- Invitation and membership mutations are audited without storing tokens or credentials.

The Supabase service-role credential is used only by the server-only Auth invitation client. Normal data access and all invitation/membership authorization continue through the signed-in user's session, RLS, and controlled RPCs.
