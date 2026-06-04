"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type SwitcherShop = { id: string; name: string };

export function ShopSwitcher({
  shops,
  activeShopId,
}: {
  shops: SwitcherShop[];
  activeShopId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [switching, setSwitching] = useState(false);

  // 0 shops (e.g. staff with no membership): nothing to switch.
  if (shops.length === 0) return null;

  // 1 shop: a static label, no control.
  if (shops.length === 1) {
    return (
      <span className="truncate font-heading text-sm font-medium text-sidebar-foreground">
        {shops[0].name || "Your shop"}
      </span>
    );
  }

  async function onChange(shopId: string) {
    if (!shopId || shopId === activeShopId) return;
    setSwitching(true);
    try {
      await fetch("/api/shop/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      startTransition(() => router.refresh());
    } finally {
      setSwitching(false);
    }
  }

  return (
    <label className="block">
      <span className="sr-only">Active shop</span>
      <select
        aria-label="Active shop"
        value={activeShopId ?? ""}
        disabled={pending || switching}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 font-heading text-sm font-medium text-sidebar-foreground disabled:opacity-60"
      >
        {shops.map((shop) => (
          <option key={shop.id} value={shop.id}>
            {shop.name || shop.id}
          </option>
        ))}
      </select>
    </label>
  );
}
