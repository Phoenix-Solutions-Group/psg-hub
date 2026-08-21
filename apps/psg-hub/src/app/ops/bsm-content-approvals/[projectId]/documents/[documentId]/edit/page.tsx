import Link from "next/link";
import { redirect } from "next/navigation";
import { ContentDraftEditor } from "@/components/ops/content-draft-editor";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { getReviewContentDraftWorkspace } from "@/lib/bsm/review-content-drafts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ContentDraftEditorPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const { projectId, documentId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_bsm_content_approvals")) {
    return <p className="rounded-lg border border-border p-6 text-sm">Your security profile does not grant access to manage Content Drafts.</p>;
  }
  const initialWorkspace = await getReviewContentDraftWorkspace({
    projectId,
    documentId,
    actorProfileId: user.id,
    actorRole: access.role,
  });

  return (
    <div className="mx-auto max-w-[1700px] space-y-4">
      <Link
        href={`/ops/bsm-content-approvals?workspaceId=${encodeURIComponent(projectId)}`}
        className="text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        Back to Content Approvals
      </Link>
      <ContentDraftEditor projectId={projectId} documentId={documentId} initialWorkspace={initialWorkspace} />
    </div>
  );
}
