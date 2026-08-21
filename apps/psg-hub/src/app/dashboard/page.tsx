import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { getDashboardPortfolio } from "@/lib/dashboard/tools";
import { ToolDashboard } from "@/components/dashboard/tool-dashboard";
import { getLatestShopAudit } from "@/lib/seo-audit/run";
import {
  buildFirstLoginValueState,
  type FirstLoginValueState,
} from "@/lib/bsm/first-login-value";
import { recordBsmPilotEvent } from "@/lib/bsm/pilot-events";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  let firstLoginValue: FirstLoginValueState | null = null;
  const [portfolio, { activeShopId }] = await Promise.all([
    getDashboardPortfolio(user.id),
    getActiveShopContext(user.id),
  ]);

  if (activeShopId) {
    const service = createServiceClient();
    const latestAudit = await getLatestShopAudit(service, activeShopId);
    firstLoginValue = buildFirstLoginValueState(latestAudit?.report ?? null);
    await recordBsmPilotEvent(service, {
      eventName: "first_login_card_viewed",
      shopId: activeShopId,
      userId: user.id,
      properties: { state: firstLoginValue.status },
    });
  } else {
    firstLoginValue = buildFirstLoginValueState(null);
  }

  return (
    <ToolDashboard
      portfolio={portfolio}
      firstName={user.email?.split("@")[0] || "there"}
      firstLoginValue={firstLoginValue}
    />
  );
}
