import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactHash, normalizeContact } from "@/lib/ops/solicitation/contact";

export interface RecordSmsConsentArgs {
  phone: string | null | undefined;
  source: string;
  capturedAt?: string;
  formData?: Record<string, unknown>;
  companyId?: string | null;
}

export async function recordSmsConsent(
  service: SupabaseClient,
  args: RecordSmsConsentArgs
): Promise<{ recorded: true; contactHash: string }> {
  const phone = normalizeContact("sms", args.phone);
  const hash = contactHash("sms", phone);
  if (phone === "" || hash === "") {
    throw new Error("SMS consent requires a valid phone number");
  }

  const { error } = await service.from("nurture_consent_events").insert({
    channel: "sms",
    contact_hash: hash,
    state: "opted_in",
    source: args.source,
    evidence_jsonb: {
      capturedAt: args.capturedAt ?? new Date().toISOString(),
      formData: args.formData ?? {},
    },
    company_id: args.companyId ?? null,
  });
  if (error) throw new Error(`SMS consent record failed: ${error.message}`);
  return { recorded: true, contactHash: hash };
}
