import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm, type SettingsFormValues } from "./settings-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Render the ACTIVE shop (switcher), not an arbitrary .limit(1) membership.
  const { shops, activeShopId } = user
    ? await getActiveShopContext(user.id)
    : { shops: [], activeShopId: null };

  const active = shops.find((s) => s.id === activeShopId) ?? null;
  const canEdit = active?.role === "owner" || active?.role === "manager";

  // Real `shops` columns (verified prod schema, PSG-779). `hours` is added by
  // migration 20260707000200_shops_hours.sql (applied at deploy).
  const { data: shop } = activeShopId
    ? await supabase
        .from("shops")
        .select(
          "name, telephone, url, radius, address_street, address_locality, address_region, address_postal_code, hours"
        )
        .eq("id", activeShopId)
        .maybeSingle()
    : { data: null };

  const initial: SettingsFormValues = {
    name: shop?.name ?? "",
    telephone: shop?.telephone ?? "",
    url: shop?.url ?? "",
    radius: shop?.radius != null ? String(shop.radius) : "",
    address_street: shop?.address_street ?? "",
    address_locality: shop?.address_locality ?? "",
    address_region: shop?.address_region ?? "",
    address_postal_code: shop?.address_postal_code ?? "",
    hours: shop?.hours ?? "",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Your shop profile and account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shop profile</CardTitle>
        </CardHeader>
        <CardContent>
          {shop ? (
            <SettingsForm
              key={activeShopId}
              initial={initial}
              email={user?.email ?? ""}
              canEdit={canEdit}
            />
          ) : (
            <p className="text-muted-foreground">
              No shop linked to your account yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
