// PSG-139 — Shop resolver: maps import rows to PSG shops / PSGIDs.
//
// Ported from `import/src/lib/shops/resolver.ts`. The only behavioural change is
// that the shop dataset is now passed in as a `ShopDirectory` (loaded from the DB
// or an env-backed loader) instead of read from a module-level global that was
// hydrated from a committed `invoiced-customers.json`. The matching logic is
// otherwise unchanged.

import { ShopDirectory, EMPTY_SHOP_DIRECTORY } from "./directory";
import { EMPTY_SHOP_REGISTRY } from "./types";
import type {
  ShopRegistry,
  InvoicedShop,
  ResolvedShop,
  UnresolvedShop,
  ShopResolution,
  AutoDetectResult,
} from "./types";

export function resolveShops(
  rows: Record<string, string>[],
  columnMap: Record<string, string>,
  directory: ShopDirectory = EMPTY_SHOP_DIRECTORY,
  registry: ShopRegistry = EMPTY_SHOP_REGISTRY
): ShopResolution {
  const buNameSource = Object.entries(columnMap).find(
    ([, canonical]) => canonical === "BUName"
  )?.[0];
  const psgKeySource = Object.entries(columnMap).find(
    ([, canonical]) => canonical === "BusinessKeyPSG"
  )?.[0];

  const sourceColumn = psgKeySource ?? buNameSource ?? null;

  const shopCounts = new Map<string, number>();
  for (const row of rows) {
    const shopValue =
      (psgKeySource ? row[psgKeySource] : null) ||
      (buNameSource ? row[buNameSource] : null) ||
      "";
    const trimmed = shopValue.trim();
    if (trimmed) {
      shopCounts.set(trimmed, (shopCounts.get(trimmed) ?? 0) + 1);
    }
  }

  const resolved: ResolvedShop[] = [];
  const unresolved: UnresolvedShop[] = [];

  // Build flat lookup from MSO registry (for variant matching)
  const msoShops = registry.msoGroups.flatMap((mso) =>
    mso.shops.map((shop) => ({ ...shop, msoName: mso.msoName }))
  );

  for (const [shopValue, count] of shopCounts) {
    const lower = shopValue.toLowerCase().trim();

    // 1. Direct PSGID match (PS + digits) against the directory
    if (/^PS\d+$/i.test(shopValue)) {
      const invoicedMatch = directory.lookup.get(lower);
      if (invoicedMatch) {
        resolved.push({
          shopName: shopValue,
          shopID: invoicedMatch.psgId,
          psgID: invoicedMatch.psgId,
          msoName: invoicedMatch.name,
          recordCount: count,
        });
        continue;
      }
    }

    // 2. Exact name match against the directory
    const invoicedMatch = directory.lookup.get(lower);
    if (invoicedMatch) {
      resolved.push({
        shopName: shopValue,
        shopID: invoicedMatch.psgId,
        psgID: invoicedMatch.psgId,
        msoName: invoicedMatch.name,
        recordCount: count,
      });
      continue;
    }

    // 2b. Normalized match: strip " - " and retry
    // Handles "Acme Collision - North" vs "Acme Collision North"
    const normalized = lower.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ");
    if (normalized !== lower) {
      const normalizedMatch = directory.lookup.get(normalized);
      if (normalizedMatch) {
        resolved.push({
          shopName: shopValue,
          shopID: normalizedMatch.psgId,
          psgID: normalizedMatch.psgId,
          msoName: normalizedMatch.name,
          recordCount: count,
        });
        continue;
      }
    }

    // 3. MSO registry: exact name match
    const msoMatch = msoShops.find((s) => s.shopName.toLowerCase() === lower);
    if (msoMatch) {
      resolved.push({
        shopName: shopValue,
        shopID: msoMatch.shopID,
        psgID: msoMatch.psgID || msoMatch.shopID,
        msoName: msoMatch.msoName,
        recordCount: count,
      });
      continue;
    }

    // 4. MSO registry: variant match
    const variantMatch = msoShops.find((s) =>
      s.shopNameVariants.some((v) => v.toLowerCase() === lower)
    );
    if (variantMatch) {
      resolved.push({
        shopName: shopValue,
        shopID: variantMatch.shopID,
        psgID: variantMatch.psgID || variantMatch.shopID,
        msoName: variantMatch.msoName,
        recordCount: count,
      });
      continue;
    }

    // 5. Partial/contains match against the directory
    let partialMatch = null;
    for (const [key, shop] of directory.lookup) {
      if (key.includes(lower) || lower.includes(key)) {
        partialMatch = shop;
        break;
      }
    }
    if (partialMatch) {
      resolved.push({
        shopName: shopValue,
        shopID: partialMatch.psgId,
        psgID: partialMatch.psgId,
        msoName: partialMatch.name,
        recordCount: count,
      });
      continue;
    }

    unresolved.push({ shopName: shopValue, recordCount: count });
  }

  return { resolved, unresolved, sourceColumn };
}

/**
 * Constrained shop resolution: matches rows only against user-selected shops.
 * Used in the shop selection flow where the user declares which shops are in the
 * file. Self-contained (no directory needed).
 */
export function resolveShopsConstrained(
  rows: Record<string, string>[],
  columnMap: Record<string, string>,
  selectedShops: InvoicedShop[]
): ShopResolution {
  const buNameSource = Object.entries(columnMap).find(
    ([, canonical]) => canonical === "BUName"
  )?.[0];

  const sourceColumn = buNameSource ?? null;

  // Count unique values in the location column
  const shopCounts = new Map<string, number>();
  for (const row of rows) {
    const shopValue = buNameSource ? (row[buNameSource] ?? "").trim() : "";
    if (shopValue) {
      shopCounts.set(shopValue, (shopCounts.get(shopValue) ?? 0) + 1);
    }
  }

  // Build lookup from selected shops (lowercase name -> shop)
  const selectedLookup = new Map<string, InvoicedShop>();
  for (const shop of selectedShops) {
    selectedLookup.set(shop.name.toLowerCase(), shop);
    // Also index the location part after " - "
    const dashIndex = shop.name.indexOf(" - ");
    if (dashIndex > 0) {
      const locationPart = shop.name
        .substring(dashIndex + 3)
        .trim()
        .toLowerCase();
      if (locationPart) {
        selectedLookup.set(locationPart, shop);
      }
    }
  }

  const resolved: ResolvedShop[] = [];
  const unresolved: UnresolvedShop[] = [];

  for (const [shopValue, count] of shopCounts) {
    const lower = shopValue.toLowerCase();

    // 1. Exact match against selected shops
    const exactMatch = selectedLookup.get(lower);
    if (exactMatch) {
      resolved.push({
        shopName: shopValue,
        shopID: exactMatch.psgId,
        psgID: exactMatch.psgId,
        msoName: exactMatch.name,
        recordCount: count,
      });
      continue;
    }

    // 2. Partial/contains match against selected shops
    let partialMatch: InvoicedShop | null = null;
    for (const [key, shop] of selectedLookup) {
      if (key.includes(lower) || lower.includes(key)) {
        partialMatch = shop;
        break;
      }
    }
    if (partialMatch) {
      resolved.push({
        shopName: shopValue,
        shopID: partialMatch.psgId,
        psgID: partialMatch.psgId,
        msoName: partialMatch.name,
        recordCount: count,
      });
      continue;
    }

    unresolved.push({ shopName: shopValue, recordCount: count });
  }

  return { resolved, unresolved, sourceColumn };
}

/**
 * Strict match: only exact name, normalized name, and PSGID matches.
 * No partial/contains matching. Used for auto-detection to avoid false positives.
 */
function strictMatchCount(values: Set<string>, directory: ShopDirectory): number {
  let matches = 0;
  for (const val of values) {
    const lower = val.toLowerCase().trim();
    if (!lower) continue;

    // PSGID match
    if (/^PS\d+$/i.test(val) && directory.lookup.has(lower)) {
      matches++;
      continue;
    }

    // Exact name match
    if (directory.lookup.has(lower)) {
      matches++;
      continue;
    }

    // Normalized match (strip " - ")
    const normalized = lower.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ");
    if (normalized !== lower && directory.lookup.has(normalized)) {
      matches++;
      continue;
    }
  }
  return matches;
}

/**
 * Auto-detect which column (if any) contains shop identifiers by scanning every
 * column against the loaded directory using STRICT matching only. No
 * partial/substring matching to avoid false positives. Returns the best column
 * and runs full resolution on it.
 */
export function autoDetectAndResolve(
  rows: Record<string, string>[],
  headers: string[],
  directory: ShopDirectory = EMPTY_SHOP_DIRECTORY,
  registry: ShopRegistry = EMPTY_SHOP_REGISTRY
): AutoDetectResult {
  let bestColumn: string | null = null;
  let bestScore = 0;

  for (const header of headers) {
    const uniqueValues = new Set(
      rows.map((r) => (r[header] ?? "").trim()).filter(Boolean)
    );
    // Skip columns with too many unique values (likely free-text, not shop ids)
    if (uniqueValues.size > 200) continue;
    // Skip empty columns
    if (uniqueValues.size === 0) continue;

    const score = strictMatchCount(uniqueValues, directory);

    if (score > bestScore) {
      bestScore = score;
      bestColumn = header;
    }
  }

  // Only count as "detected" if we strictly matched at least 1 shop
  if (bestScore >= 1 && bestColumn) {
    // Now run full resolution on the winning column
    const testMap: Record<string, string> = {};
    const sampleValues = rows
      .slice(0, 20)
      .map((r) => (r[bestColumn!] ?? "").trim())
      .filter(Boolean);
    const psgIdCount = sampleValues.filter((v) => /^PS\d+$/i.test(v)).length;
    testMap[bestColumn] =
      psgIdCount > sampleValues.length * 0.5 ? "BusinessKeyPSG" : "BUName";

    const resolution = resolveShops(rows, testMap, directory, registry);
    return { detected: true, column: bestColumn, resolution };
  }

  return { detected: false, column: null, resolution: null };
}
