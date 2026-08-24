"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAuthAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/context";
import { acceptInvitationSchema, invitationIdSchema, invitationSchema, memberUpdateSchema } from "@/lib/validation/users";
import type { ActionResult } from "@/app/actions/auth";

const friendly=(message:string)=>message.includes("already a member")?"This user is already a member of this farm.":message.includes("already pending")?"An invitation is already pending for this email.":message.includes("wait before")?"Please wait a minute before resending this invitation.":message.includes("another administrator")?"Assign another administrator before changing this user's access.":message.includes("denied")?"You do not have permission to manage farm users.":"We couldn't complete that user-management request. Please try again.";

async function sendExistingAccountInvitationEmail(email:string,origin:string){
  const s=await createClient();
  return s.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${origin}/invite-redirect`}});
}

export async function inviteUserAction(input:unknown):Promise<ActionResult>{
  const parsed=invitationSchema.safeParse(input);if(!parsed.success)return{ok:false,message:parsed.error.issues[0].message};
  await requireRole(["admin"]);const s=await createClient();
  const{data:invitation,error}=await s.rpc("create_farm_invitation",{target_email:parsed.data.email,target_role:parsed.data.role});
  if(error||!invitation)return{ok:false,message:friendly(error?.message??"")};
  try{
    const origin=(await headers()).get("origin")??"http://localhost:3000";
    const admin=createAuthAdminClient();
    const{data:mailData,error:mailError}=await admin.auth.admin.inviteUserByEmail(parsed.data.email,{redirectTo:`${origin}/invite-redirect`,data:{invitation_id:invitation.id}});
    if(mailError){
      if(/already|registered|exists/i.test(mailError.message)){
        const{error:existingMailError}=await sendExistingAccountInvitationEmail(parsed.data.email,origin);
        if(existingMailError)return{ok:false,message:"The invitation was saved, but the email could not be sent. Use Resend to try again."};
        revalidatePath("/settings/users");return{ok:true,message:"Invitation sent. This person already has an account and can accept it without changing their password."};
      }
      return{ok:false,message:"The invitation was saved, but the email could not be sent. Use Resend to try again."};
    }
    if(mailData.user?.id)await s.rpc("link_farm_invitation_auth_user",{target_invitation:invitation.id,target_auth_user:mailData.user.id});
    revalidatePath("/settings/users");return{ok:true,message:"Invitation sent."};
  }catch{return{ok:false,message:"The invitation was saved, but email delivery is not configured. Use Resend after configuration is complete."};}
}

export async function resendInvitationAction(input:unknown):Promise<ActionResult>{
  const id=invitationIdSchema.safeParse(input);if(!id.success)return{ok:false,message:id.error.issues[0].message};await requireRole(["admin"]);const s=await createClient();
  const{data,error}=await s.rpc("mark_farm_invitation_resent",{target_invitation:id.data});if(error||!data)return{ok:false,message:friendly(error?.message??"")};
  try{const origin=(await headers()).get("origin")??"http://localhost:3000",admin=createAuthAdminClient();if(!data.auth_user_id){const{error:mailError}=await sendExistingAccountInvitationEmail(data.email,origin);if(mailError)return{ok:false,message:"We couldn't resend the invitation email. Please try again later."};revalidatePath("/settings/users");return{ok:true,message:"Invitation resent. This person can accept it without changing their password."};}await admin.auth.admin.deleteUser(data.auth_user_id);const{data:mailData,error:mailError}=await admin.auth.admin.inviteUserByEmail(data.email,{redirectTo:`${origin}/invite-redirect`,data:{invitation_id:data.id}});if(mailError||!mailData.user?.id)return{ok:false,message:"We couldn't resend the invitation email. Please try again later."};await s.rpc("link_farm_invitation_auth_user",{target_invitation:data.id,target_auth_user:mailData.user.id});}catch{return{ok:false,message:"We couldn't resend the invitation email. Please try again later."};}
  revalidatePath("/settings/users");return{ok:true,message:"Invitation resent."};
}

export async function revokeInvitationAction(input:unknown):Promise<ActionResult>{const id=invitationIdSchema.safeParse(input);if(!id.success)return{ok:false,message:id.error.issues[0].message};await requireRole(["admin"]);const s=await createClient();const{error}=await s.rpc("revoke_farm_invitation",{target_invitation:id.data});if(error)return{ok:false,message:friendly(error.message)};revalidatePath("/settings/users");return{ok:true,message:"Invitation revoked."};}

export async function updateMemberAction(input:unknown):Promise<ActionResult>{const parsed=memberUpdateSchema.safeParse(input);if(!parsed.success)return{ok:false,message:parsed.error.issues[0].message};await requireRole(["admin"]);const s=await createClient();const{error}=await s.rpc("manage_farm_member",{target_membership:parsed.data.membershipId,new_role:parsed.data.role??null,new_active:parsed.data.active??null});if(error)return{ok:false,message:friendly(error.message)};revalidatePath("/settings/users");return{ok:true,message:"Farm user updated."};}

export async function acceptInvitationAction(input: unknown): Promise<ActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in through the invitation link first." };

  const { data: pendingInvitations, error: pendingError } = await supabase.rpc(
    "get_pending_farm_invitations",
  );
  const ownsInvitation = pendingInvitations?.some(
    (invitation: { id: string }) => invitation.id === parsed.data.invitationId,
  );
  if (pendingError || !ownsInvitation) {
    return { ok: false, message: "This invitation is no longer valid." };
  }

  const { error } = await supabase.rpc("accept_farm_invitation", {
    target_invitation: parsed.data.invitationId,
  });
  if (error) return { ok: false, message: "This invitation is no longer valid." };

  revalidatePath("/settings/users");
  return { ok: true, message: "Invitation accepted. Continue to HabFarms." };
}
