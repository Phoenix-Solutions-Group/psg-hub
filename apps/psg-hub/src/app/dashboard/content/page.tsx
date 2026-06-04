import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { ContentTable } from "@/components/dashboard/content-table";

export default async function ContentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Scope content to the ACTIVE shop (switcher). RLS clamps to member shops;
  // this narrows within that set. No active shop -> empty list.
  const { activeShopId } = user
    ? await getActiveShopContext(user.id)
    : { activeShopId: null };

  const { data: items } = activeShopId
    ? await supabase
        .from("content_items")
        .select("id, title, content_type, status, updated_at")
        .eq("shop_id", activeShopId)
        .order("updated_at", { ascending: false })
    : { data: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content</h1>
        <p className="text-muted-foreground">
          Review and approve agent-produced content.
        </p>
      </div>
      <ContentTable items={items || []} />
    </div>
  );
}
