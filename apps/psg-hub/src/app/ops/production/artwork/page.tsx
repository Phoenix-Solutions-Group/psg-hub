import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { MailArtworkEditor } from "@/components/ops/mail-artwork-editor";

export default async function MailArtworkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "design_mail_artwork")) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Mail artwork editor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          PSG-only freeform editor for postcard front/back. Upload logo and base graphic, position elements,
          and run zone checks before generating a production-ready artwork doc.
        </p>
      </div>
      <MailArtworkEditor />
    </div>
  );
}
