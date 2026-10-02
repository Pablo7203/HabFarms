"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptInvitationAction,
  inviteUserAction,
  resendInvitationAction,
  revokeInvitationAction,
  updateMemberAction,
} from "@/app/actions/users";
import { createClient } from "@/lib/supabase/client";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

type Result = { ok: boolean; message: string };
const Notice = ({ result }: { result: Result | null }) =>
  result ? (
    <p
      role="status"
      className={`rounded-lg p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
    >
      {result.message}
    </p>
  ) : null;

export function InviteUserForm() {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("worker"),
    [result, setResult] = useState<Result | null>(null),
    [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await inviteUserAction({ email, role });
          setResult(r);
          if (r.ok) setEmail("");
        });
      }}
    >
      <label className="text-sm font-medium">
        Email Address
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-lg border px-3"
          placeholder="person@example.com"
        />
      </label>
      <label className="text-sm font-medium">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-lg border px-3"
        >
          <option value="worker">Worker</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <p className="text-sm text-stone-600">
        The user will receive an email inviting them to join this farm.
      </p>
      <Notice result={result} />
      <button
        disabled={pending}
        className="min-h-11 rounded-lg bg-emerald-700 px-4 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Sending Invitation..." : "Send Invitation"}
      </button>
    </form>
  );
}

export function InvitationActions({ id }: { id: string }) {
  const [result, setResult] = useState<Result | null>(null),
    [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          disabled={pending}
          onClick={() =>
            start(async () => setResult(await resendInvitationAction(id)))
          }
          className="min-h-11 rounded-lg border px-3 text-sm font-semibold"
        >
          {pending ? "Working..." : "Resend"}
        </button>
        <ConfirmActionDialog
          triggerLabel="Revoke"
          title="Revoke this invitation?"
          description="The recipient will no longer be able to use this invitation to join the farm."
          confirmLabel="Revoke invitation"
          disabled={pending}
          triggerClassName="min-h-11 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          onConfirm={async () => {
            const response = await revokeInvitationAction(id);
            setResult(response);
            return response;
          }}
        />
      </div>
      <Notice result={result} />
    </div>
  );
}

export function MemberActions({
  id,
  role,
  active,
}: {
  id: string;
  role: string;
  active: boolean;
}) {
  const [nextRole, setNextRole] = useState(role),
    [result, setResult] = useState<Result | null>(null),
    [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`role-${id}`}>
          Role
        </label>
        <select
          id={`role-${id}`}
          value={nextRole}
          onChange={(e) => setNextRole(e.target.value)}
          className="min-h-11 rounded-lg border px-2 capitalize"
        >
          <option value="worker">Worker</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <button
          disabled={pending || nextRole === role}
          onClick={() =>
            start(async () =>
              setResult(
                await updateMemberAction({ membershipId: id, role: nextRole }),
              ),
            )
          }
          className="min-h-11 rounded-lg border px-3 text-sm font-semibold"
        >
          Update role
        </button>
        {active ? (
          <ConfirmActionDialog
            triggerLabel="Deactivate"
            title="Remove this user's farm access?"
            description="They will lose access to this farm immediately. Their existing farm records will remain."
            confirmLabel="Deactivate user"
            disabled={pending}
            triggerClassName="min-h-11 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            onConfirm={async () => {
              const response = await updateMemberAction({ membershipId: id, active: false });
              setResult(response);
              return response;
            }}
          />
        ) : (
          <button
            disabled={pending}
            onClick={() => start(async () => setResult(await updateMemberAction({ membershipId: id, active: true })))}
            className="min-h-11 rounded-lg border px-3 text-sm font-semibold text-emerald-700"
          >
            Reactivate
          </button>
        )}
      </div>
      <Notice result={result} />
    </div>
  );
}

export function AcceptInvitationForm({
  id,
  farm,
  role,
  requiresPasswordSetup,
}: {
  id: string;
  farm: string;
  role: string;
  requiresPasswordSetup: boolean;
}) {
  const [password, setPassword] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="rounded-xl border bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          if (requiresPasswordSetup) {
            const { error } = await createClient().auth.updateUser({
              password,
            });
            if (error) {
              setResult({
                ok: false,
                message: "We couldn't set your password. Please try again.",
              });
              return;
            }
          }
          const accepted = await acceptInvitationAction({ invitationId: id });
          setResult(accepted);
          if (accepted.ok && accepted.nextPath) router.replace(accepted.nextPath);
        });
      }}
    >
      <h2 className="font-semibold">Join {farm}</h2>
      <p className="mt-1 text-sm text-stone-600">
        Role: <span className="capitalize">{role}</span>
      </p>
      {requiresPasswordSetup && (
        <label className="mt-4 block text-sm font-medium">
          Choose a password
          <input
            required
            minLength={8}
            autoComplete="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-lg border px-3"
          />
        </label>
      )}
      <div className="mt-4">
        <Notice result={result} />
      </div>
      {result?.ok ? <p className="mt-4 text-sm font-medium text-emerald-800">Opening your farm…</p> : (
        <button
          disabled={pending}
          className="mt-4 min-h-11 w-full rounded-lg bg-emerald-700 px-4 font-semibold text-white disabled:opacity-60"
        >
          {pending
            ? "Accepting..."
            : requiresPasswordSetup
              ? "Set Password and Accept Invitation"
              : "Accept Invitation"}
        </button>
      )}
    </form>
  );
}
