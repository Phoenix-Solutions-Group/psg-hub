import invoicedCustomers from "./invoiced-customers.json";

export interface InvoicedShop {
  name: string;
  psgId: string;
  invoicedId: number;
  city: string;
  state: string;
  // Billing metadata (optional — older shops may lack these)
  nameRate?: number;
  advantageProductId?: string;
  webHostingId?: string;
  webHostingPrice?: number;
  webHostingDiscount?: number;
  dontAddWhm?: boolean;
  customPricingProductId?: string;
  parentInvoicedId?: number;
}

export interface Shop {
  shopName: string;
  shopNameVariants: string[];
  shopID: string;
  psgID: string;
  invoicedAccountNumber: string;
}

export interface MSOGroup {
  msoName: string;
  msoID: string;
  shops: Shop[];
}

export interface ShopRegistry {
  version: string;
  lastUpdated: string;
  msoGroups: MSOGroup[];
}

// Full customer list from Invoiced API (842 shops)
export const INVOICED_SHOPS: InvoicedShop[] = invoicedCustomers as InvoicedShop[];

// Quick lookup: lowercase name -> InvoicedShop
export const INVOICED_LOOKUP = new Map<string, InvoicedShop>();
for (const shop of INVOICED_SHOPS) {
  INVOICED_LOOKUP.set(shop.name.toLowerCase(), shop);
  // Also index by psgId for reverse lookups
  INVOICED_LOOKUP.set(shop.psgId.toLowerCase(), shop);
}

// Quick lookup: invoicedId -> InvoicedShop
export const INVOICED_BY_ID = new Map<number, InvoicedShop>();
for (const shop of INVOICED_SHOPS) {
  INVOICED_BY_ID.set(shop.invoicedId, shop);
}

// Shops grouped by parentInvoicedId (for MSO accounts without " - " naming)
export const INVOICED_PARENT_GROUPS = new Map<number, InvoicedShop[]>();
for (const shop of INVOICED_SHOPS) {
  if (!shop.parentInvoicedId) continue;
  const existing = INVOICED_PARENT_GROUPS.get(shop.parentInvoicedId) ?? [];
  existing.push(shop);
  INVOICED_PARENT_GROUPS.set(shop.parentInvoicedId, existing);
}

// --- MSO Auto-Grouping ---

export interface MSOAutoGroup {
  msoName: string;
  prefix: string;
  shops: InvoicedShop[];
}

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

/** Pre-computed MSO groups from Invoiced data */
export const INVOICED_MSO_GROUPS: MSOAutoGroup[] = buildMSOGroups(INVOICED_SHOPS);

/** Get all shops in the same MSO group as the given shop */
export function getMSOChildren(shopName: string): InvoicedShop[] {
  // Prefix pattern: "X - Location"
  const dashIndex = shopName.indexOf(" - ");
  if (dashIndex >= 3) {
    const prefix = shopName.substring(0, dashIndex).trim();
    const group = INVOICED_MSO_GROUPS.find((g) => g.prefix === prefix);
    if (group && group.shops.length >= 2) return group.shops;
  }
  // parentInvoicedId pattern: shops share a parent account (e.g. LaMettry's)
  const shop = INVOICED_LOOKUP.get(shopName.toLowerCase());
  if (shop?.parentInvoicedId) {
    const siblings = INVOICED_PARENT_GROUPS.get(shop.parentInvoicedId) ?? [];
    if (siblings.length >= 2) return siblings;
  }
  return [];
}

// Legacy MSO registry (kept for variant matching)
export const DEFAULT_SHOP_REGISTRY: ShopRegistry = {
  version: "2.0",
  lastUpdated: "2026-04-12",
  msoGroups: [
    {
      msoName: "LaMettry's Collision",
      msoID: "LAMC",
      shops: [
        {
          shopName: "LaMettry's Collision - Minnetonka",
          shopNameVariants: ["LaMettry's Minnetonka", "LAMC Minnetonka"],
          shopID: "PS1049",
          psgID: "PS1049",
          invoicedAccountNumber: "",
        },
        {
          shopName: "LaMettry's Collision - Bloomington",
          shopNameVariants: ["LaMettry's Bloomington", "LAMC Bloomington"],
          shopID: "PS633",
          psgID: "PS633",
          invoicedAccountNumber: "",
        },
        {
          shopName: "LaMettry's Collision - Burnsville",
          shopNameVariants: ["LaMettry's Burnsville", "LAMC Burnsville"],
          shopID: "PS632",
          psgID: "PS632",
          invoicedAccountNumber: "",
        },
        {
          shopName: "LaMettry's Collision - Blaine",
          shopNameVariants: ["LaMettry's Blaine", "LAMC Blaine"],
          shopID: "PS1159",
          psgID: "PS1159",
          invoicedAccountNumber: "",
        },
        {
          shopName: "LaMettry's Collision - Richfield",
          shopNameVariants: ["LaMettry's Richfield", "LAMC Richfield"],
          shopID: "PS161",
          psgID: "PS161",
          invoicedAccountNumber: "",
        },
      ],
    },
  ],
};
