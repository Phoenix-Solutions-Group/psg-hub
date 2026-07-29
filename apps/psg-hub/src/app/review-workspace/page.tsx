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
      <main className="flex min-h-svh w-full flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <div className="w-full max-w-lg rounded-lg border border-border p-6">
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
