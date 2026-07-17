import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBsmCustomerReviewItem, BsmCustomerReviewError } from "@/lib/bsm/customer-content-review";
import { Badge } from "@/components/ui/badge";
import { BsmContentReviewActions } from "@/components/dashboard/bsm-content-review-actions";

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function BsmContentApprovalReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  let item;
  try {
    item = await getBsmCustomerReviewItem(supabase, id, user.id);
  } catch (error) {
    if (error instanceof BsmCustomerReviewError && (error.status === 403 || error.status === 404)) {
      notFound();
    }
    throw error;
  }

  const previewUrl =
    typeof item.currentVersion?.sourceMetadata.previewUrl === "string"
      ? item.currentVersion.sourceMetadata.previewUrl
      : typeof item.currentVersion?.sourceMetadata.generatedPagePath === "string"
        ? item.currentVersion.sourceMetadata.generatedPagePath
        : null;

  const restoreVersionId = item.versions.find((version) => version.id !== item.currentVersionId)?.id ?? item.currentVersionId;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/approvals" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Back to approvals
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{item.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{label(item.status)}</Badge>
            <span className="text-sm text-muted-foreground">{label(item.contentType)}</span>
            <span className="text-sm text-muted-foreground">Updated {formatDate(item.updatedAt)}</span>
          </div>
        </div>
      </div>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="font-heading text-lg font-semibold">Review content</h2>
        {item.contextNote && <p className="whitespace-pre-wrap text-sm text-foreground/90">{item.contextNote}</p>}
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
          <p className="font-medium">
            {item.currentVersion?.originalFilename ?? `Version ${item.currentVersion?.versionNumber ?? 1}`}
          </p>
          {previewUrl ? (
            <a className="mt-2 inline-flex font-medium text-ember hover:text-foreground" href={previewUrl}>
              Open preview
            </a>
          ) : (
            <p className="mt-2 text-muted-foreground">
              File stored for approval. PSG can provide the source file from the approval archive.
            </p>
          )}
        </div>
      </section>

      <BsmContentReviewActions reviewItemId={item.id} restoreVersionId={restoreVersionId ?? null} />

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-heading text-lg font-semibold">Comments</h2>
          {item.comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          ) : (
            item.comments.map((comment) => (
              <div key={comment.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(comment.createdAt)}</p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-heading text-lg font-semibold">Versions</h2>
          {item.versions.map((version) => (
            <div key={version.id} className="flex items-center justify-between border-t border-border pt-3 first:border-t-0 first:pt-0">
              <div>
                <p className="text-sm font-medium">{version.label ?? `Version ${version.versionNumber}`}</p>
                <p className="text-xs text-muted-foreground">{formatDate(version.createdAt)}</p>
              </div>
              {version.id === item.currentVersionId && <Badge variant="success">Current</Badge>}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-heading text-lg font-semibold">Decision history</h2>
          {item.decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decision recorded yet.</p>
          ) : (
            item.decisions.map((decision) => (
              <div key={decision.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium">{label(decision.decision)}</p>
                {decision.message && <p className="mt-1 text-sm text-muted-foreground">{decision.message}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(decision.createdAt)}</p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="font-heading text-lg font-semibold">Restore requests</h2>
          {item.restoreRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No restore requests yet.</p>
          ) : (
            item.restoreRequests.map((request) => (
              <div key={request.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium">{label(request.status)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{request.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(request.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
