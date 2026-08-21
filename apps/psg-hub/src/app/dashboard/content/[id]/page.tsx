import { notFound } from "next/navigation";
import { headers } from "next/headers";
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

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  published: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
};

function customerPublicationStatus(status: string) {
  return status === "published" ? "Published" : "Draft";
}

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
        requestHost,
      })
    : null;
  const useRiversidePreviewFallback = user
    ? shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: user.email,
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

  if (user) {
    try {
      const reviewItem = await getBsmCustomerReviewItem(supabase, id, user.id);

      return (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{reviewItem.title}</h1>
              <div className="mt-2 flex items-center gap-3">
                <Badge
                  variant="secondary"
                  className={statusColors[reviewItem.status] || ""}
                >
                  {customerPublicationStatus(reviewItem.status)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {reviewItem.contentType.replace(/_/g, " ")}
                </span>
                <span className="text-sm text-muted-foreground">
                  Updated{" "}
                  {new Date(reviewItem.updatedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          </div>

          <ContentPreview body={bodyFromReviewItem(reviewItem)} />
        </div>
      );
    } catch (error) {
      if (!(error instanceof BsmCustomerReviewError) || (error.status !== 403 && error.status !== 404)) {
        throw error;
      }
    }
  }

  let query = contentReader
    .from("content_items")
    .select("*")
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{item.title}</h1>
          <div className="mt-2 flex items-center gap-3">
            <Badge
              variant="secondary"
              className={statusColors[item.status] || ""}
            >
              {customerPublicationStatus(item.status)}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {item.content_type.replace(/_/g, " ")}
            </span>
            <span className="text-sm text-muted-foreground">
              Updated{" "}
              {new Date(item.updated_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        {item.status === "pending_review" && (
          <ApprovalActions contentId={item.id} />
        )}
      </div>

      <ContentPreview body={item.body} />
    </div>
  );
}
