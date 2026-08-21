import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";

export type RequestListItem = {
  id: string;
  title: string;
  kind: string;
  detail: string | null;
  status: string;
  updatedAt: string;
  href: string | null;
  actionLabel?: string;
};

type QuickApprovalRecord = {
  id: string;
  action_type: string;
  title: string;
  summary: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  published_at: string | null;
};

type ContentReviewRecord = {
  id: string;
  title: string;
  status: string;
  content_type: string;
  admin_context_note: string | null;
  updated_at: string;
};

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function quickApprovalKind(actionType: string) {
  const labels: Record<string, string> = {
    content: "Content",
    gbp_post: "Google Business Profile post",
    review_reply: "Public review response",
    review_solicitation: "Customer review request",
  };
  return labels[actionType] ?? humanize(actionType);
}

function quickApprovalStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Needs decision",
    publish_failed: "Publish failed",
    approved: "Approved",
    rejected: "Rejected",
    published: "Published",
    superseded: "Superseded",
  };
  return labels[status] ?? humanize(status);
}

function contentReviewStatus(status: string) {
  const labels: Record<string, string> = {
    sent: "Needs decision",
    in_review: "In review",
    updates_requested: "Changes requested",
    approved: "Approved",
    declined: "Declined",
  };
  return labels[status] ?? humanize(status);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RequestList({
  items,
  emptyTitle,
  emptyDetail,
}: {
  items: RequestListItem[];
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
        <p className="font-heading font-medium">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{emptyDetail}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      {items.map((item) => {
        const content = (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="font-heading font-semibold text-foreground">{item.title}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                  {item.kind}
                </span>
              </div>
              {item.detail && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.detail}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Updated {formatDate(item.updatedAt)}</p>
            </div>
            <div className="flex w-full shrink-0 items-center justify-between gap-3 sm:w-auto">
              <span className="whitespace-nowrap rounded-full bg-midnight-soft px-2.5 py-1 text-xs font-medium text-midnight">
                {item.status}
              </span>
              {item.href && (
                <span className="font-heading text-sm font-medium text-midnight">
                  {item.actionLabel ?? "Open request"}
                </span>
              )}
            </div>
          </>
        );

        return item.href ? (
          <Link
            key={item.id}
            href={item.href}
            className="flex min-h-24 flex-col items-stretch gap-3 border-t border-border px-5 py-4 transition-colors first:border-t-0 hover:bg-midnight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ember sm:flex-row sm:items-center sm:gap-4"
          >
            {content}
          </Link>
        ) : (
          <div
            key={item.id}
            className="flex min-h-24 flex-col items-stretch gap-3 border-t border-border px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:gap-4"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showHistory = view === "history";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const activeRequests: RequestListItem[] = [];
  const historyRequests: RequestListItem[] = [];

  if (user) {
    const { shops, activeShopId } = await getActiveShopContext(user.id);
    const activeRole = shops.find((shop) => shop.id === activeShopId)?.role;
    const canDecideForShop = activeRole === "owner" || activeRole === "manager";

    if (activeShopId) {
      const quickRequest = canDecideForShop
        ? supabase
            .from("approval_queue")
            .select("id, action_type, title, summary, status, created_at, decided_at, published_at")
            .eq("shop_id", activeShopId)
            .in("status", ["pending", "publish_failed", "approved", "rejected", "published", "superseded"])
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] });
      const contentRequest = canDecideForShop
        ? supabase
            .from("bsm_content_review_items")
            .select("id, title, status, content_type, admin_context_note, updated_at")
            .eq("shop_id", activeShopId)
            .is("project_id", null)
            .in("status", ["sent", "in_review", "updates_requested", "approved", "declined"])
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [] });
      const service = createServiceClient();
      const invitationSelect = "id, project_id, round_id, submitted_at, created_at, project:bsm_content_review_projects!inner(title, status, current_round_id)";
      const activeInvitationRequest = service
        .from("bsm_content_review_invitations")
        .select(invitationSelect)
        .eq("shop_id", activeShopId)
        .eq("reviewer_profile_id", user.id)
        .in("status", ["sent", "viewed"])
        .is("revoked_at", null)
        .gt("expires_at", "now");
      const submittedInvitationRequest = service
        .from("bsm_content_review_invitations")
        .select(invitationSelect)
        .eq("shop_id", activeShopId)
        .eq("reviewer_profile_id", user.id)
        .eq("status", "submitted")
        .is("revoked_at", null);

      const [
        { data: quickRows },
        { data: contentRows },
        { data: activeInvitations },
        { data: submittedInvitations },
      ] = await Promise.all([
        quickRequest,
        contentRequest,
        activeInvitationRequest,
        submittedInvitationRequest,
      ]);

      for (const row of (quickRows ?? []) as QuickApprovalRecord[]) {
        const isActive = row.status === "pending" || row.status === "publish_failed";
        const item: RequestListItem = {
          id: `quick-${row.id}`,
          title: row.title,
          kind: quickApprovalKind(row.action_type),
          detail: row.summary,
          status: quickApprovalStatus(row.status),
          updatedAt: row.published_at ?? row.decided_at ?? row.created_at,
          href: isActive ? `/dashboard/approvals/${encodeURIComponent(row.id)}` : null,
          actionLabel: row.status === "publish_failed" ? "Review and retry" : "Review and decide",
        };
        (isActive ? activeRequests : historyRequests).push(item);
      }

      for (const row of (contentRows ?? []) as ContentReviewRecord[]) {
        const isActive = row.status === "sent" || row.status === "in_review";
        const item: RequestListItem = {
          id: `content-${row.id}`,
          title: row.title,
          kind: `${humanize(row.content_type)} review`,
          detail: row.admin_context_note,
          status: contentReviewStatus(row.status),
          updatedAt: row.updated_at,
          href: isActive ? `/dashboard/approvals/content/${encodeURIComponent(row.id)}` : null,
          actionLabel: "Review and decide",
        };
        (isActive ? activeRequests : historyRequests).push(item);
      }

      const invitationRows = [
        ...(activeInvitations ?? []),
        ...(submittedInvitations ?? []),
      ] as Array<Record<string, unknown>>;
      const invitationIds = invitationRows.map((row) => row.id as string);
      const { data: reviewers } = invitationIds.length
        ? await service
            .from("bsm_content_review_reviewers")
            .select("invitation_id")
            .eq("shop_id", activeShopId)
            .eq("profile_id", user.id)
            .eq("reviewer_role", "reviewer")
            .is("removed_at", null)
            .in("invitation_id", invitationIds)
        : { data: [] };
      const assignedInvitationIds = new Set(
        (reviewers ?? []).map((row) => row.invitation_id as string),
      );
      for (const row of invitationRows) {
        if (!assignedInvitationIds.has(row.id as string)) continue;
        const project = Array.isArray(row.project) ? row.project[0] : row.project;
        if (!project || project.current_round_id !== row.round_id) continue;

        const submittedAt = (row.submitted_at as string | null) ?? null;
        const projectIsActive = ["active", "inviting"].includes(project.status as string);
        const isActive = !submittedAt && projectIsActive;
        const isHistory = Boolean(submittedAt) || !projectIsActive;
        if (!isActive && !isHistory) continue;

        const item: RequestListItem = {
          id: `workspace-${row.project_id as string}`,
          title: project.title as string,
          kind: "Review Workspace",
          detail: "Comment on the shared documents and submit your decisions.",
          status: submittedAt ? "Submitted" : isActive ? "Needs decision" : "Closed",
          updatedAt: submittedAt ?? (row.created_at as string),
          href: isActive || submittedAt
            ? `/dashboard/approvals/review-workspace/${encodeURIComponent(row.project_id as string)}`
            : null,
          actionLabel: submittedAt ? "View submitted review" : "Open workspace",
        };
        (isActive ? activeRequests : historyRequests).push(item);
      }
    }
  }

  activeRequests.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  historyRequests.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const visibleRequests = showHistory ? historyRequests : activeRequests;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Review Requests</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          See what needs your decision. Each request opens with the exact content,
          consequence, and next step.
        </p>
      </div>

      <nav className="flex gap-6 border-b border-border" aria-label="Review request views">
        <Link
          href="/dashboard/approvals"
          aria-current={!showHistory ? "page" : undefined}
          className={`border-b-2 px-1 pb-3 font-heading text-sm font-medium transition-colors ${
            !showHistory
              ? "border-ember text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Needs your decision
          {activeRequests.length > 0 && (
            <span className="ml-2 rounded-full bg-midnight px-2 py-0.5 text-xs text-paper">
              {activeRequests.length}
            </span>
          )}
        </Link>
        <Link
          href="/dashboard/approvals?view=history"
          aria-current={showHistory ? "page" : undefined}
          className={`border-b-2 px-1 pb-3 font-heading text-sm font-medium transition-colors ${
            showHistory
              ? "border-ember text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          History
        </Link>
      </nav>

      <RequestList
        items={visibleRequests}
        emptyTitle={showHistory ? "No review history yet" : "You are all caught up"}
        emptyDetail={
          showHistory
            ? "Completed, rejected, and superseded requests will appear here."
            : "New requests will appear here only when your decision is needed."
        }
      />
    </div>
  );
}
