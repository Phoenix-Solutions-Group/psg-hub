import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { ComponentProps } from "react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { getBsmCustomerReviewItem, BsmCustomerReviewError } from "@/lib/bsm/customer-content-review";
import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  getRiversideAnalyticsPreviewShop,
  shouldUseRiversideAnalyticsPreviewFallback,
} from "@/lib/bsm/riverside-analytics-demo";
import { findRiversideDemoContentItem } from "@/lib/bsm/riverside-demo-content";
import { Badge } from "@/components/ui/badge";
import { ContentPreview } from "@/components/dashboard/content-preview";
import { ApprovalActions } from "@/components/dashboard/approval-actions";

type ContentStatusBadgeVariant = ComponentProps<typeof Badge>["variant"];

const statusBadgeVariants: Record<string, ContentStatusBadgeVariant> = {
  draft: "secondary",
  sent: "warning",
  in_review: "warning",
  pending_review: "warning",
  updates_requested: "warning",
  approved: "success",
  published: "success",
  declined: "destructive",
  rejected: "destructive",
};

function isRiversideDemoHost(host: string | null): boolean {
  return (host ?? "").trim().toLowerCase().split(":")[0] === "hub.psgweb.me";
}

function bodyFromReviewItem(item: Awaited<ReturnType<typeof getBsmCustomerReviewItem>>) {
  const metadata = item.currentVersion?.sourceMetadata ?? {};
  const bodyCandidates = [
    metadata.body,
    metadata.markdown,
    metadata.content,
    metadata.draftBody,
    metadata.generatedBody,
    item.contextNote,
  ];
  return bodyCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
}

function ContentHeader({
  title,
  status,
  contentType,
  updatedAt,
}: {
  title: string;
  status: string;
  contentType: string;
  updatedAt: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-2 flex items-center gap-3">
        <Badge variant={statusBadgeVariants[status] ?? "secondary"}>
          {status.replace(/_/g, " ")}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {contentType.replace(/_/g, " ")}
        </span>
        <span className="text-sm text-muted-foreground">
          Updated{" "}
          {new Date(updatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
    </div>
  );
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const service = createServiceClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { shops, activeShopId } = user
    ? await getActiveShopContext(user.id)
    : { shops: [], activeShopId: null };
  const activeShopName =
    shops.find((shop) => shop.id === activeShopId)?.name ?? null;
  const requestHost = (await headers()).get("host");
  const previewShop = user
    ? await getRiversideAnalyticsPreviewShop(service, {
        userEmail: user.email,
        activeShopName,
        requestHost,
      })
    : null;
  const useRiversidePreviewFallback = user
    ? shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: user.email,
        activeShopName,
        requestHost,
      })
    : false;
  const riversideDemoShop = shops.find(
    (shop) => shop.name === RIVERSIDE_ANALYTICS_DEMO_SHOP.name
  );
  const isRiversideShopContext = Boolean(
    previewShop ??
      riversideDemoShop ??
      (activeShopName === RIVERSIDE_ANALYTICS_DEMO_SHOP.name &&
        isRiversideDemoHost(requestHost))
  );
  const effectiveShopId =
    previewShop?.id ?? riversideDemoShop?.id ?? activeShopId;
  const contentReader = previewShop ? service : supabase;

  const reviewItem = user
    ? await getBsmCustomerReviewItem(supabase, id, user.id).catch((error: unknown) => {
        if (error instanceof BsmCustomerReviewError && (error.status === 403 || error.status === 404)) {
          return null;
        }

        throw error;
      })
    : null;

  if (reviewItem) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <ContentHeader
            title={reviewItem.title}
            status={reviewItem.status}
            contentType={reviewItem.contentType}
            updatedAt={reviewItem.updatedAt}
          />
        </div>

        <ContentPreview body={bodyFromReviewItem(reviewItem)} />
      </div>
    );
  }

  let query = contentReader
    .from("content_items")
    .select("*, content_type:type")
    .eq("id", id);

  if (effectiveShopId) {
    query = query.eq("shop_id", effectiveShopId);
  }

  const { data: queriedItem } = await query.single();
  const item =
    queriedItem ??
    (useRiversidePreviewFallback || isRiversideShopContext ? findRiversideDemoContentItem(id) : null);

  if (!item) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <ContentHeader
          title={item.title}
          status={item.status}
          contentType={item.content_type}
          updatedAt={item.updated_at}
        />
        {item.status === "pending_review" && (
          <ApprovalActions contentId={item.id} />
        )}
      </div>

      <ContentPreview body={item.body} />
    </div>
  );
}
