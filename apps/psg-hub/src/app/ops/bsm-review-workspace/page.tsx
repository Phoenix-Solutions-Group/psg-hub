import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function normalizeCompanyShops(rows: Array<{ shop_id: unknown; name: unknown }>) {
  const shopsById = new Map<string, { id: string; name: string }>();

  for (const row of rows) {
    if (typeof row.shop_id !== "string" || !row.shop_id.trim()) continue;
    const id = row.shop_id;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
    const existing = shopsById.get(id);
    if (!existing || existing.name === id) {
      shopsById.set(id, { id, name });
    }
  }

  return [...shopsById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default async function BsmReviewWorkspacePage() {
  redirect("/ops/bsm-content-approvals");
}
