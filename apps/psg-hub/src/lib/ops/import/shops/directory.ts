// PSG-139 — Shop directory: the in-memory lookup structure built from a runtime
// dataset. Ported from `import/src/lib/shops/registry.ts`, but the data is now
// INJECTED (from the DB or an env-backed loader) instead of a committed JSON.
//
// All builders here are pure functions over a provided `InvoicedShop[]`; no
// module-level data and no `invoiced-customers.json` import.

import type { InvoicedShop, MSOAutoGroup } from "./types";

/**
 * Build MSO groups by detecting common name prefixes.
 * Shops with names like "X - Location" are grouped under prefix "X".
 * Only groups with 2+ shops are returned.
 */
export function buildMSOGroups(shops: InvoicedShop[]): MSOAutoGroup[] {
  const prefixMap = new Map<string, InvoicedShop[]>();

  for (const shop of shops) {
    if (shop.name.includes("(deleted)")) continue;
    const dashIndex = shop.name.indexOf(" - ");
    if (dashIndex < 3) continue; // no prefix or too short
    const prefix = shop.name.substring(0, dashIndex).trim();
    const existing = prefixMap.get(prefix) ?? [];
    existing.push(shop);
    prefixMap.set(prefix, existing);
  }

  const groups: MSOAutoGroup[] = [];
  for (const [prefix, members] of prefixMap) {
    if (members.length >= 2) {
      groups.push({
        msoName: prefix,
        prefix,
        shops: members.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  }

  return groups.sort((a, b) => a.msoName.localeCompare(b.msoName));
}

/**
 * In-memory shop directory. Holds the lookups the resolver needs, built once from
 * a runtime-loaded shop dataset. Replaces the old module-level `INVOICED_LOOKUP`
 * / `INVOICED_BY_ID` / `INVOICED_PARENT_GROUPS` / `INVOICED_MSO_GROUPS` globals.
 */
export class ShopDirectory {
  readonly shops: readonly InvoicedShop[];
  /** lowercase name -> shop, and lowercase psgId -> shop (reverse lookup). */
  readonly lookup: Map<string, InvoicedShop>;
  /** invoicedId -> shop. */
  readonly byId: Map<number, InvoicedShop>;
  /** parentInvoicedId -> child shops (MSO accounts without " - " naming). */
  readonly parentGroups: Map<number, InvoicedShop[]>;
  /** Pre-computed MSO groups detected from name prefixes. */
  readonly msoGroups: MSOAutoGroup[];

  constructor(shops: InvoicedShop[]) {
    this.shops = shops;

    this.lookup = new Map<string, InvoicedShop>();
    for (const shop of shops) {
      this.lookup.set(shop.name.toLowerCase(), shop);
      this.lookup.set(shop.psgId.toLowerCase(), shop);
    }

    this.byId = new Map<number, InvoicedShop>();
    for (const shop of shops) {
      this.byId.set(shop.invoicedId, shop);
    }

    this.parentGroups = new Map<number, InvoicedShop[]>();
    for (const shop of shops) {
      if (!shop.parentInvoicedId) continue;
      const existing = this.parentGroups.get(shop.parentInvoicedId) ?? [];
      existing.push(shop);
      this.parentGroups.set(shop.parentInvoicedId, existing);
    }

    this.msoGroups = buildMSOGroups(shops);
  }

  /** Get all shops in the same MSO group as the given shop. */
  getMSOChildren(shopName: string): InvoicedShop[] {
    // Prefix pattern: "X - Location"
    const dashIndex = shopName.indexOf(" - ");
    if (dashIndex >= 3) {
      const prefix = shopName.substring(0, dashIndex).trim();
      const group = this.msoGroups.find((g) => g.prefix === prefix);
      if (group && group.shops.length >= 2) return group.shops;
    }
    // parentInvoicedId pattern: shops share a parent MSO account
    const shop = this.lookup.get(shopName.toLowerCase());
    if (shop?.parentInvoicedId) {
      const siblings = this.parentGroups.get(shop.parentInvoicedId) ?? [];
      if (siblings.length >= 2) return siblings;
    }
    return [];
  }
}

/** Convenience builder. */
export function buildShopDirectory(shops: InvoicedShop[]): ShopDirectory {
  return new ShopDirectory(shops);
}

/** An empty directory — safe default when no dataset has been loaded. */
export const EMPTY_SHOP_DIRECTORY = new ShopDirectory([]);
