import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { ContentTable } from "@/components/dashboard/content-table";
import { ApprovedContentArchiveTable } from "@/components/dashboard/approved-content-archive-table";
import { listApprovedContentArchiveRows } from "@/lib/bsm/approved-content-archive";
import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  getRiversideAnalyticsPreviewShop,
  shouldUseRiversideAnalyticsPreviewFallback,
} from "@/lib/bsm/riverside-analytics-demo";
import { RIVERSIDE_DEMO_CONTENT_ITEMS } from "@/lib/bsm/riverside-demo-content";

type DashboardContentItem = {
  id: string;
  title: string;
  content_type: string;
  status: string;
  updated_at: string;
};

const CUSTOMER_VISIBLE_REVIEW_STATUSES = [
  "draft",
  "sent",
  "in_review",
  "updates_requested",
  "approved",
  "declined",
];

function isRiversideDemoHost(host: string | null): boolean {
  return (host ?? "").trim().toLowerCase().split(":")[0] === "hub.psgweb.me";
}

function mergeRiversideDemoItems(items: DashboardContentItem[]) {
  const seenTitles = new Set(items.map((item) => item.title));
  return [
    ...items,
    ...RIVERSIDE_DEMO_CONTENT_ITEMS.filter((item) => !seenTitles.has(item.title)),
  ];
}

function mergeCustomerContentItems(
  reviewItems: DashboardContentItem[],
  contentItems: DashboardContentItem[]
) {
  const merged: DashboardContentItem[] = [];
  const seenKeys = new Set<string>();

  for (const item of [...reviewItems, ...contentItems]) {
    const key = item.id || item.title.trim().toLowerCase();
    const titleKey = item.title.trim().toLowerCase();

    if (seenKeys.has(key) || seenKeys.has(titleKey)) continue;

    seenKeys.add(key);
    seenKeys.add(titleKey);
    merged.push(item);
  }

  return merged.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

export default async function ContentPage() {
  const supabase = await createClient();
  const service = createServiceClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Scope content to the ACTIVE shop (switcher). RLS clamps to member shops;
  // this narrows within that set. No active shop -> empty list.
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

  const { data: reviewItems } = effectiveShopId
    ? await service
        .from("bsm_content_review_items")
        .select("id, title, content_type, status, updated_at")
        .eq("shop_id", effectiveShopId)
        .in("status", CUSTOMER_VISIBLE_REVIEW_STATUSES)
        .order("updated_at", { ascending: false })
    : { data: [] };

  const { data: queriedItems } = effectiveShopId
    ? await contentReader
        .from("content_items")
        .select("id, title, content_type, status, updated_at")
        .eq("shop_id", effectiveShopId)
        .order("updated_at", { ascending: false })
    : { data: [] };
  const items = mergeCustomerContentItems(
    (reviewItems ?? []) as DashboardContentItem[],
    (queriedItems ?? []) as DashboardContentItem[]
  );
  const displayItems =
    useRiversidePreviewFallback || isRiversideShopContext
      ? mergeRiversideDemoItems(items)
      : items;
  const approvedVersions = effectiveShopId
    ? await listApprovedContentArchiveRows(contentReader, effectiveShopId)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content Library</h1>
        <p className="text-muted-foreground">
          Browse draft, approved, and published content. Anything that needs
          your decision appears in Review Requests.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="all-content-heading">
        <h2 id="all-content-heading" className="font-heading text-lg font-semibold tracking-tight">
          All content
        </h2>
        <ContentTable items={displayItems} />
      </section>

      <section className="space-y-3" aria-labelledby="approved-versions-heading">
        <div>
          <h2 id="approved-versions-heading" className="font-heading text-lg font-semibold tracking-tight">
            Approved versions
          </h2>
          <p className="text-sm text-muted-foreground">
            Reference the exact files and generated pages that were approved.
          </p>
        </div>
        <ApprovedContentArchiveTable rows={approvedVersions} />
      </section>
    </div>
  );
}
