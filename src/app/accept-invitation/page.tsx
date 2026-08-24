import { redirect } from "next/navigation";
import { AcceptInvitationForm } from "@/components/forms/user-management";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function AcceptInvitationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data } = (await supabase.rpc("get_pending_farm_invitations")) as {
    data: Array<{
      id: string;
      role: string;
      farm_name: string;
      requires_password_setup: boolean;
    }> | null;
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-12">
      <Card className="w-full max-w-lg p-6 sm:p-9">
        <div className="grid size-12 place-items-center rounded-xl bg-emerald-700 text-xl font-bold text-white">
          P
        </div>
        <h1 className="mt-7 text-3xl font-bold tracking-tight">Accept invitation</h1>
        <p className="mt-2 text-stone-600">
          Review and accept each farm invitation addressed to your account.
        </p>
        <div className="mt-6 space-y-4">
          {data?.map((invitation) => (
            <AcceptInvitationForm
              key={invitation.id}
              id={invitation.id}
              farm={invitation.farm_name}
              role={invitation.role}
              requiresPasswordSetup={invitation.requires_password_setup}
            />
          ))}
          {!data?.length && (
            <p className="rounded-xl border bg-white p-6 text-stone-600">
              There are no valid pending invitations for this signed-in email.
            </p>
          )}
        </div>
      </Card>
    </main>
  );
}
