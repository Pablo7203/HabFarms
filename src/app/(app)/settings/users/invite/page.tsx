import { Card } from "@/components/ui/card";
import { InviteUserForm } from "@/components/forms/user-management";
import { requireRole } from "@/lib/auth/context";
export default async function InviteUserPage(){const c=await requireRole(["admin"]);return <div className="mx-auto max-w-xl"><h1 className="text-3xl font-bold">Invite User</h1><p className="mt-2 text-stone-600">Invite a manager or worker to join {c.farm.name}.</p><Card className="mt-6 p-5 sm:p-7"><InviteUserForm/></Card></div>}
