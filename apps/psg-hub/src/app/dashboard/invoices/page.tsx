import { redirect } from "next/navigation";
import { getActiveShopContext } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";

/**
 * Compatibility entry point for the customer invoices link used by the BSM
 * preview. The invoice UI remains owned by the shop-scoped route; resolving the
 * active shop here avoids duplicating its tenant-safe query and payment logic.
 */
export default async function InvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { activeShopId } = await getActiveShopContext(user.id);
  if (!activeShopId) {
    redirect("/dashboard");
  }

  redirect(`/dashboard/shop/${encodeURIComponent(activeShopId)}/invoices`);
}
