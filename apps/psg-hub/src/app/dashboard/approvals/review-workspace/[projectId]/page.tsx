import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReviewerWorkspace } from "@/app/review-workspace/reviewer-workspace";
import { ReviewWorkspaceInputError, requireAssignedReviewerAccess } from "@/lib/bsm/review-workspace";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AssignedReviewWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    await requireAssignedReviewerAccess(createServiceClient(), projectId, user.id);
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError && (error.status === 400 || error.status === 403 || error.status === 404)) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard/approvals" className="text-sm font-medium text-muted-foreground hover:text-foreground">
        Back to approvals
      </Link>
      <ReviewerWorkspace projectId={projectId} />
    </div>
  );
}
