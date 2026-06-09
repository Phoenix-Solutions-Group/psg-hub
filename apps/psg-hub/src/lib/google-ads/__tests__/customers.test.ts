import { describe, it, expect } from "vitest";
import { listManagedAccounts } from "@/lib/google-ads/customers";
import { AdsApiError } from "@/lib/google-ads/types";

function rowsFixture() {
  return [
    // the MCC itself (manager) — must be filtered out
    { customer_client: { id: "6935795509", descriptive_name: "PSG MCC", manager: true, level: 0, status: "ENABLED" } },
    { customer_client: { id: "6048611995", descriptive_name: "Wallace Collision", manager: false, level: 1, status: "ENABLED" } },
    { customer_client: { id: 1234567890, descriptive_name: "Tracy's", manager: false, level: 1, status: "ENABLED" } },
    // duplicate of Wallace — de-dup
    { customer_client: { id: "6048611995", descriptive_name: "Wallace dup", manager: false, level: 2, status: "ENABLED" } },
    // bad (non-10-digit) id — skip
    { customer_client: { id: "123", descriptive_name: "Bad", manager: false, level: 1, status: "ENABLED" } },
    // missing name → falls back to id
    { customer_client: { id: "9999999999", manager: false, level: 1, status: "ENABLED" } },
  ];
}

describe("listManagedAccounts", () => {
  it("returns non-manager 10-digit accounts, de-duped, name-or-id", async () => {
    const out = await listManagedAccounts("rt", "6935795509", {
      query: async () => rowsFixture(),
    });
    expect(out).toEqual([
      { id: "6048611995", name: "Wallace Collision" },
      { id: "1234567890", name: "Tracy's" },
      { id: "9999999999", name: "9999999999" },
    ]);
  });

  it("excludes the manager (MCC) row", async () => {
    const out = await listManagedAccounts("rt", "6935795509", {
      query: async () => rowsFixture(),
    });
    expect(out.find((a) => a.id === "6935795509")).toBeUndefined();
  });

  it("empty hierarchy → empty list", async () => {
    const out = await listManagedAccounts("rt", "6935795509", { query: async () => [] });
    expect(out).toEqual([]);
  });

  it("maps a query failure through mapGoogleAdsError", async () => {
    await expect(
      listManagedAccounts("rt", "6935795509", {
        query: async () => {
          throw new Error("permission denied for customer");
        },
      })
    ).rejects.toBeInstanceOf(AdsApiError);
  });
});
