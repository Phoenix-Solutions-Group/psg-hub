import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { ContentTable } from "@/components/dashboard/content-table";
import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  getRiversideAnalyticsPreviewShop,
  shouldUseRiversideAnalyticsPreviewFallback,
} from "@/lib/bsm/riverside-analytics-demo";
import { RIVERSIDE_DEMO_CONTENT_ITEM } from "@/lib/bsm/riverside-demo-content";

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
  const effectiveShopId =
    previewShop?.id ?? riversideDemoShop?.id ?? activeShopId;
  const contentReader = previewShop ? service : supabase;

  const { data: queriedItems } = effectiveShopId
    ? await contentReader
        .from("content_items")
        .select("id, title, content_type:type, status, updated_at")
        .eq("shop_id", effectiveShopId)
        .order("updated_at", { ascending: false })
    : { data: [] };
  const items =
    useRiversidePreviewFallback && (queriedItems ?? []).length === 0
      ? [RIVERSIDE_DEMO_CONTENT_ITEM]
      : queriedItems ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content</h1>
        <p className="text-muted-foreground">
          Review and approve agent-produced content.
        </p>
      </div>
      <ContentTable items={items} />
    </div>
  );
}
