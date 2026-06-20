// PSG-139 — shop registry/resolver tests. All fixtures are SYNTHETIC (no real
// shop or billing data); validates structure + resolver behaviour after the
// de-PII port.

import { describe, it, expect } from "vitest";
import {
  ShopDirectory,
  buildShopDirectory,
  buildMSOGroups,
  EMPTY_SHOP_DIRECTORY,
} from "@/lib/ops/import/shops/directory";
import {
  resolveShops,
  resolveShopsConstrained,
  autoDetectAndResolve,
} from "@/lib/ops/import/shops/resolver";
import {
  mapInvoicedRow,
  shopDirectoryFromEnv,
  loadShopDirectoryFromDb,
  type InvoicedCustomerRow,
  type ShopDirectoryClient,
} from "@/lib/ops/import/shops/loader";
import { EMPTY_SHOP_REGISTRY, type ShopRegistry, type InvoicedShop } from "@/lib/ops/import/shops/types";

// --- Synthetic dataset (fictional shops) ---
const SHOPS: InvoicedShop[] = [
  { name: "Acme Collision - North", psgId: "PS100", invoicedId: 1, city: "Springfield", state: "IL", parentInvoicedId: 50 },
  { name: "Acme Collision - South", psgId: "PS101", invoicedId: 2, city: "Springfield", state: "IL", parentInvoicedId: 50 },
  { name: "Solo Body Works", psgId: "PS200", invoicedId: 3, city: "Quahog", state: "RI" },
  { name: "Zenith Auto (deleted)", psgId: "PS300", invoicedId: 4, city: "Pawnee", state: "IN" },
];

const directory = buildShopDirectory(SHOPS);

const REGISTRY: ShopRegistry = {
  version: "1.0",
  lastUpdated: "2026-06-20",
  msoGroups: [
    {
      msoName: "Variant MSO",
      msoID: "VM",
      shops: [
        {
          shopName: "Variant Shop Official",
          shopNameVariants: ["VShop", "Variant Nick"],
          shopID: "PS900",
          psgID: "PS900",
          invoicedAccountNumber: "",
        },
        {
          shopName: "No PSGID Shop",
          shopNameVariants: ["NoPS"],
          shopID: "PS901",
          psgID: "",
          invoicedAccountNumber: "",
        },
      ],
    },
  ],
};

describe("ShopDirectory", () => {
  it("builds name + psgId lookups", () => {
    expect(directory.lookup.get("acme collision - north")?.psgId).toBe("PS100");
    expect(directory.lookup.get("ps200")?.name).toBe("Solo Body Works");
  });

  it("indexes by invoicedId and parent group", () => {
    expect(directory.byId.get(3)?.psgId).toBe("PS200");
    expect(directory.parentGroups.get(50)?.length).toBe(2);
  });

  it("auto-groups MSO by name prefix, skipping (deleted) and short prefixes", () => {
    const groups = buildMSOGroups(SHOPS);
    expect(groups).toHaveLength(1);
    expect(groups[0].prefix).toBe("Acme Collision");
    expect(groups[0].shops.map((s) => s.psgId)).toEqual(["PS100", "PS101"]);
  });

  it("getMSOChildren resolves via prefix and via parentInvoicedId", () => {
    expect(directory.getMSOChildren("Acme Collision - North").map((s) => s.psgId)).toEqual([
      "PS100",
      "PS101",
    ]);
    // Solo shop has no group
    expect(directory.getMSOChildren("Solo Body Works")).toEqual([]);
  });

  it("empty directory yields no matches", () => {
    expect(EMPTY_SHOP_DIRECTORY.shops).toHaveLength(0);
    expect(new ShopDirectory([]).lookup.size).toBe(0);
  });
});

describe("resolveShops", () => {
  it("matches by direct PSGID", () => {
    const res = resolveShops(
      [{ key: "PS100" }, { key: "PS100" }, { key: "PS200" }],
      { key: "BusinessKeyPSG" },
      directory
    );
    expect(res.sourceColumn).toBe("key");
    const ps100 = res.resolved.find((r) => r.psgID === "PS100");
    expect(ps100?.recordCount).toBe(2);
    expect(res.unresolved).toHaveLength(0);
  });

  it("matches by exact name", () => {
    const res = resolveShops(
      [{ bu: "Acme Collision - North" }, { bu: "Solo Body Works" }],
      { bu: "BUName" },
      directory
    );
    expect(res.resolved.map((r) => r.psgID).sort()).toEqual(["PS100", "PS200"]);
  });

  it("matches by normalized name when input has a dash but the stored name does not", () => {
    // Stored "Solo Body Works" (no dash); input "Solo - Body - Works" normalizes
    // to "solo body works" and matches.
    const res = resolveShops([{ bu: "Solo - Body - Works" }], { bu: "BUName" }, directory);
    expect(res.resolved[0]?.psgID).toBe("PS200");
  });

  it("falls back to MSO registry exact + variant matches", () => {
    const res = resolveShops(
      [{ bu: "Variant Shop Official" }, { bu: "VShop" }, { bu: "NoPS" }],
      { bu: "BUName" },
      directory,
      REGISTRY
    );
    const byPsg = res.resolved.map((r) => r.psgID).sort();
    // PS900 (exact + variant) and PS901 (variant, psgID empty -> shopID fallback)
    expect(byPsg).toContain("PS900");
    expect(byPsg).toContain("PS901");
  });

  it("falls back to partial/contains match", () => {
    const res = resolveShops([{ bu: "Solo Body" }], { bu: "BUName" }, directory);
    expect(res.resolved[0]?.psgID).toBe("PS200");
  });

  it("reports unresolved shops", () => {
    const res = resolveShops([{ bu: "Totally Unknown XYZ" }], { bu: "BUName" }, directory);
    expect(res.unresolved[0]?.shopName).toBe("Totally Unknown XYZ");
    expect(res.resolved).toHaveLength(0);
  });

  it("defaults to empty directory + empty registry with no matches", () => {
    const res = resolveShops([{ bu: "Acme Collision - North" }], { bu: "BUName" });
    expect(res.resolved).toHaveLength(0);
    expect(res.unresolved).toHaveLength(1);
  });
});

describe("resolveShopsConstrained", () => {
  it("matches against the user-selected shop set, exact + location part", () => {
    const res = resolveShopsConstrained(
      [{ loc: "Acme Collision - North" }, { loc: "North" }, { loc: "Mystery" }],
      { loc: "BUName" },
      SHOPS
    );
    expect(res.resolved.filter((r) => r.psgID === "PS100").length).toBeGreaterThanOrEqual(1);
    expect(res.unresolved.map((u) => u.shopName)).toContain("Mystery");
  });

  it("returns null source column when BUName not mapped", () => {
    const res = resolveShopsConstrained([{ x: "Acme" }], { x: "Other" }, SHOPS);
    expect(res.sourceColumn).toBeNull();
  });
});

describe("autoDetectAndResolve", () => {
  it("detects the shop column and resolves it", () => {
    const rows = [
      { name: "Alice", shop: "PS100" },
      { name: "Bob", shop: "PS200" },
    ];
    const res = autoDetectAndResolve(rows, ["name", "shop"], directory);
    expect(res.detected).toBe(true);
    expect(res.column).toBe("shop");
    expect(res.resolution?.resolved.length).toBe(2);
  });

  it("returns not-detected when nothing matches", () => {
    const res = autoDetectAndResolve([{ a: "foo" }], ["a"], directory);
    expect(res.detected).toBe(false);
    expect(res.resolution).toBeNull();
  });

  it("uses the empty-directory default (no match) when omitted", () => {
    const res = autoDetectAndResolve([{ shop: "PS100" }], ["shop"]);
    expect(res.detected).toBe(false);
  });
});

describe("loader", () => {
  it("mapInvoicedRow merges columns + billing metadata, drops zero parent", () => {
    const row: InvoicedCustomerRow = {
      invoiced_id: "7",
      psg_id: "PS700",
      name: "Loader Shop",
      city: "Town",
      state: "TX",
      parent_invoiced_id: 0,
      metadata: { nameRate: 12.5, advantageProductId: "ap_1" },
    };
    const shop = mapInvoicedRow(row);
    expect(shop.invoicedId).toBe(7);
    expect(shop.nameRate).toBe(12.5);
    expect(shop.advantageProductId).toBe("ap_1");
    expect(shop.parentInvoicedId).toBeUndefined();
  });

  it("mapInvoicedRow falls back to metadata city/state/parent", () => {
    const row: InvoicedCustomerRow = {
      invoiced_id: 8,
      psg_id: "PS800",
      name: "Meta Shop",
      city: null,
      state: null,
      parent_invoiced_id: null,
      metadata: { city: "MetaCity", state: "MC", parentInvoicedId: 99 },
    };
    const shop = mapInvoicedRow(row);
    expect(shop.city).toBe("MetaCity");
    expect(shop.state).toBe("MC");
    expect(shop.parentInvoicedId).toBe(99);
  });

  it("loadShopDirectoryFromDb queries and builds the directory", async () => {
    const rows: InvoicedCustomerRow[] = [
      { invoiced_id: 1, psg_id: "PS100", name: "Acme Collision - North", city: "S", state: "IL", parent_invoiced_id: 50, metadata: {} },
      { invoiced_id: 2, psg_id: "PS101", name: "Acme Collision - South", city: "S", state: "IL", parent_invoiced_id: 50, metadata: {} },
    ];
    const client: ShopDirectoryClient = {
      from: () => ({ select: async () => ({ data: rows, error: null }) }),
    };
    const dir = await loadShopDirectoryFromDb(client);
    expect(dir.shops).toHaveLength(2);
    expect(dir.getMSOChildren("Acme Collision - North")).toHaveLength(2);
  });

  it("loadShopDirectoryFromDb throws on db error", async () => {
    const client: ShopDirectoryClient = {
      from: () => ({ select: async () => ({ data: null, error: { message: "denied" } }) }),
    };
    await expect(loadShopDirectoryFromDb(client)).rejects.toThrow(/denied/);
  });

  it("shopDirectoryFromEnv parses a JSON array, fail-closed on bad/missing", () => {
    const ok = shopDirectoryFromEnv({ OPS_SHOP_DIRECTORY_JSON: JSON.stringify(SHOPS) });
    expect(ok.shops).toHaveLength(SHOPS.length);
    expect(shopDirectoryFromEnv({}).shops).toHaveLength(0);
    expect(shopDirectoryFromEnv({ OPS_SHOP_DIRECTORY_JSON: "not json{" }).shops).toHaveLength(0);
    expect(
      shopDirectoryFromEnv({ OPS_SHOP_DIRECTORY_JSON: '{"not":"array"}' }).shops
    ).toHaveLength(0);
  });
});

describe("EMPTY_SHOP_REGISTRY", () => {
  it("is an empty registry shape", () => {
    expect(EMPTY_SHOP_REGISTRY.msoGroups).toHaveLength(0);
  });
});
