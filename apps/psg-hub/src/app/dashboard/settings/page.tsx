import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("shop_members")
    .select("shop_id, role, shops(name, slug, website_url, phone, city, state)")
    .limit(1)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shopsData = memberships?.shops as any;
  const shop = Array.isArray(shopsData) ? shopsData[0] : shopsData ?? null;

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
