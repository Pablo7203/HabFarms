import "server-only";
import { createAuthAdminClient } from "@/lib/supabase/admin";

type Communication = { id: string; farm_id: string; message_type: string; recipient_email: string; attempt_count: number; farms: { name: string } | null };

const messageCopy: Record<string, { subject: (farm: string) => string; body: (farm: string) => string }> = {
  trial_expiring: { subject: (farm) => `${farm}: your HabFarms trial is ending soon`, body: (farm) => `Your HabFarms trial for ${farm} is ending soon. Please contact support if you need help with your subscription.` },
  past_due: { subject: (farm) => `${farm}: your HabFarms subscription needs attention`, body: (farm) => `Your HabFarms subscription for ${farm} is past due. Please contact support to keep the account in good standing.` },
  grace_ending: { subject: (farm) => `${farm}: your HabFarms grace period is ending`, body: (farm) => `The grace period for ${farm} is ending soon. Please contact support to avoid an interruption.` },
  suspension: { subject: (farm) => `${farm}: HabFarms account suspended`, body: (farm) => `The HabFarms account for ${farm} has been suspended. Please contact support to discuss reactivation.` },
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);

export type DeliveryResult = { sent: number; failed: number; pending: number; providerConfigured: boolean };

export async function deliverPlatformCommunications(limit = 25): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PLATFORM_EMAIL_FROM;
  const admin = createAuthAdminClient();
  const { data: raw } = await admin.from("platform_communications").select("id,farm_id,message_type,recipient_email,attempt_count,farms(name)").in("status", ["pending", "failed"]).order("created_at").limit(limit);
  const messages = (raw ?? []) as unknown as Communication[];
  if (!apiKey || !from) return { sent: 0, failed: 0, pending: messages.length, providerConfigured: false };

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    const farmName = message.farms?.name ?? "your farm";
    const copy = messageCopy[message.message_type];
    if (!copy) continue;
    const now = new Date().toISOString();
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [message.recipient_email], subject: copy.subject(farmName), text: copy.body(farmName), html: `<p>${escapeHtml(copy.body(farmName))}</p>` }),
      });
      if (!response.ok) throw new Error(`provider_${response.status}`);
      await admin.from("platform_communications").update({ status: "sent", attempt_count: message.attempt_count + 1, attempted_at: now, sent_at: now, failed_at: null, last_error_category: null }).eq("id", message.id);
      await admin.rpc("platform_audit_system", { target_action: "communication.sent", target_farm: message.farm_id, target_type: "platform_communications", target_id: message.id, target_metadata: { message_type: message.message_type } });
      sent += 1;
    } catch {
      await admin.from("platform_communications").update({ status: "failed", attempt_count: message.attempt_count + 1, attempted_at: now, failed_at: now, last_error_category: "provider_delivery_failed" }).eq("id", message.id);
      await admin.rpc("platform_audit_system", { target_action: "communication.failed", target_farm: message.farm_id, target_type: "platform_communications", target_id: message.id, target_metadata: { message_type: message.message_type } });
      failed += 1;
    }
  }
  return { sent, failed, pending: Math.max(0, messages.length - sent - failed), providerConfigured: true };
}
