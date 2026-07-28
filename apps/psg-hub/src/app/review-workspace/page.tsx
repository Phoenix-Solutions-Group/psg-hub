import { ReviewerWorkspace } from "@/app/review-workspace/reviewer-workspace";
import { bsmReviewWorkspaceInternalEnabled } from "@/lib/bsm/review-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReviewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-lg border border-border p-6">
          <h1 className="font-heading text-lg font-semibold">Review workspace unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This internal QA surface is disabled in this environment.
          </p>
        </div>
      </main>
    );
  }

  const params = await searchParams;
  return <ReviewerWorkspace inviteToken={params.invite ?? ""} />;
}
