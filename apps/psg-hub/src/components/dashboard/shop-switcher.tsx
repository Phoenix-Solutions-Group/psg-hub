"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type SwitcherShop = { id: string; name: string };

// 09-02: big-MSO search/typeahead. Below this membership count the original
// plain <select> renders byte-identically (e2e shop-switch.spec contract).
export const TYPEAHEAD_THRESHOLD = 8;

/** Pure, node-testable filter: case-insensitive substring on shop name. */
export function filterShops(
  shops: SwitcherShop[],
  query: string
): SwitcherShop[] {
  const q = query.trim().toLowerCase();
  if (!q) return shops;
  return shops.filter((s) => (s.name || s.id).toLowerCase().includes(q));
}

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
  const [query, setQuery] = useState("");

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

  // 2..TYPEAHEAD_THRESHOLD-1 shops: the original plain select, unchanged.
  if (shops.length < TYPEAHEAD_THRESHOLD) {
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

  // Big MSO (>= TYPEAHEAD_THRESHOLD): a search input filters the same native
  // select. Native elements only — no custom combobox ARIA to get wrong.
  const filtered = filterShops(shops, query);
  // Keep the ACTIVE shop selectable even when filtered out, so the select's
  // value always corresponds to a rendered option.
  const active = shops.find((s) => s.id === activeShopId);
  const options =
    active && !filtered.some((s) => s.id === active.id)
      ? [active, ...filtered]
      : filtered;

  return (
    <div className="space-y-1.5">
      <input
        type="search"
        aria-label="Search shops"
        placeholder="Search shops…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50"
      />
      <p aria-live="polite" className="text-xs text-sidebar-foreground/70">
        {filtered.length} of {shops.length} shops
      </p>
      <label className="block">
        <span className="sr-only">Active shop</span>
        <select
          aria-label="Active shop"
          value={activeShopId ?? ""}
          disabled={pending || switching}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 font-heading text-sm font-medium text-sidebar-foreground disabled:opacity-60"
        >
          {options.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name || shop.id}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
