import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Render the ACTIVE shop (switcher), not an arbitrary .limit(1) membership.
  const { activeShopId } = user
    ? await getActiveShopContext(user.id)
    : { activeShopId: null };

  // Live `shops` schema diverges from the inherited code: there is no
  // website_url/phone/city/state. Alias the real columns (06-04 pattern) so the
  // existing JSX keys (shop.website_url, shop.phone, shop.city, shop.state) keep working.
  // RLS clamps to the member's shops; activeShopId is already a validated membership.
  const { data: shop } = activeShopId
    ? await supabase
        .from("shops")
        .select(
          "name, slug, website_url:url, phone:telephone, city:address_locality, state:address_region"
        )
        .eq("id", activeShopId)
        .maybeSingle()
    : { data: null };

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
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Name
                </dt>
                <dd className="mt-1 text-foreground">{shop.name}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Website
                </dt>
                <dd className="mt-1 text-foreground">
                  {shop.website_url || "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Phone
                </dt>
                <dd className="mt-1 text-foreground">
                  {shop.phone || "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Location
                </dt>
                <dd className="mt-1 text-foreground">
                  {shop.city && shop.state
                    ? `${shop.city}, ${shop.state}`
                    : "Not set"}
                </dd>
              </div>
            </dl>
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
