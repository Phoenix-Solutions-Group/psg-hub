import { describe, it, expect } from "vitest";
import {
  listGbpAccounts,
  listGbpLocations,
  listGbpAccountsAndLocations,
  type GbpAccountLike,
  type GbpLocationLike,
} from "@/lib/google-oauth/gbp-enumerate";
import { GoogleApiError } from "@/lib/google-oauth/client";

// The deps.listPage seams inject the raw API page bodies; the default googleapis
// clients never run.

describe("listGbpAccounts", () => {
  it("maps + flattens accounts across pages (follows nextPageToken)", async () => {
    const pages: Record<
      string,
      { accounts?: GbpAccountLike[]; nextPageToken?: string }
    > = {
      "": {
        accounts: [
          {
            name: "accounts/111",
            accountName: "Wallace Collision",
            type: "PERSONAL",
            role: "PRIMARY_OWNER",
            verificationState: "VERIFIED",
          },
        ],
        nextPageToken: "p2",
      },
      p2: {
        accounts: [
          {
            name: "accounts/222",
            accountName: "Agency Group",
            type: "LOCATION_GROUP",
            role: "MANAGER",
            verificationState: "UNVERIFIED",
          },
        ],
      },
    };
    const out = await listGbpAccounts("rt", {
      listPage: async (pageToken) => pages[pageToken ?? ""],
    });
    expect(out.map((a) => a.name)).toEqual(["accounts/111", "accounts/222"]);
    expect(out[0]).toMatchObject({ type: "PERSONAL", role: "PRIMARY_OWNER" });
    expect(out[1]).toMatchObject({ type: "LOCATION_GROUP", role: "MANAGER" });
  });

  it("skips nameless accounts; empty -> []", async () => {
    const out = await listGbpAccounts("rt", {
      listPage: async () => ({ accounts: [{ accountName: "no name" }, {}] }),
    });
    expect(out).toEqual([]);
    expect(
      await listGbpAccounts("rt", { listPage: async () => ({}) })
    ).toEqual([]);
  });

  it("maps a Gaxios error (HTTP 403) to a GoogleApiError(auth_failed)", async () => {
    const gaxios = Object.assign(
      new Error("Request failed with status code 403"),
      { code: "ERR_BAD_REQUEST", response: { status: 403 } }
    );
    await expect(
      listGbpAccounts("rt", {
        listPage: async () => {
          throw gaxios;
        },
      })
    ).rejects.toBeInstanceOf(GoogleApiError);
    await expect(
      listGbpAccounts("rt", {
        listPage: async () => {
          throw gaxios;
        },
      })
    ).rejects.toMatchObject({ code: "auth_failed" });
  });
});

describe("listGbpLocations", () => {
  it("maps the BARE locations/{id} as id, carries the parent + VoM, joins address", async () => {
    const out = await listGbpLocations("rt", "accounts/111", {
      listPage: async () => ({
        locations: [
          {
            name: "locations/555", // bare — no account prefix
            title: "Wallace Collision Center",
            storefrontAddress: {
              addressLines: ["123 Main St"],
              locality: "Naperville",
              administrativeArea: "IL",
              postalCode: "60540",
              regionCode: "US",
            },
            metadata: { hasVoiceOfMerchant: true },
          },
        ],
      }),
    });
    expect(out).toEqual([
      {
        id: "locations/555",
        name: "Wallace Collision Center",
        address: "123 Main St, Naperville, IL, 60540",
        parent: "accounts/111",
        hasVoiceOfMerchant: true,
      },
    ]);
  });

  it("defaults VoM to false when metadata is absent; falls back title->id", async () => {
    const out = await listGbpLocations("rt", "accounts/111", {
      listPage: async () => ({
        locations: [{ name: "locations/777" }],
      }),
    });
    expect(out[0]).toMatchObject({
      id: "locations/777",
      name: "locations/777",
      address: null,
      parent: "accounts/111",
      hasVoiceOfMerchant: false,
    });
  });

  it("paginates + de-dupes by bare id", async () => {
    const pages: Record<
      string,
      { locations?: GbpLocationLike[]; nextPageToken?: string }
    > = {
      "": { locations: [{ name: "locations/1", title: "A" }], nextPageToken: "n" },
      n: {
        locations: [
          { name: "locations/1", title: "A dup" },
          { name: "locations/2", title: "B" },
        ],
      },
    };
    const out = await listGbpLocations("rt", "accounts/111", {
      listPage: async (_parent, pageToken) => pages[pageToken ?? ""],
    });
    expect(out.map((l) => l.id)).toEqual(["locations/1", "locations/2"]);
  });

  it("maps an upstream error to GoogleApiError", async () => {
    await expect(
      listGbpLocations("rt", "accounts/111", {
        listPage: async () => {
          throw Object.assign(new Error("429"), { response: { status: 429 } });
        },
      })
    ).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("listGbpAccountsAndLocations", () => {
  it("flattens locations across all accounts, carrying each parent", async () => {
    const out = await listGbpAccountsAndLocations("rt", {
      listAccountsPage: async () => ({
        accounts: [
          { name: "accounts/111", type: "PERSONAL" },
          { name: "accounts/222", type: "LOCATION_GROUP" },
        ],
      }),
      listLocationsPage: async (parent) =>
        parent === "accounts/111"
          ? { locations: [{ name: "locations/1", title: "Shop One" }] }
          : { locations: [{ name: "locations/2", title: "Shop Two" }] },
    });
    expect(out).toEqual([
      {
        id: "locations/1",
        name: "Shop One",
        address: null,
        parent: "accounts/111",
        hasVoiceOfMerchant: false,
      },
      {
        id: "locations/2",
        name: "Shop Two",
        address: null,
        parent: "accounts/222",
        hasVoiceOfMerchant: false,
      },
    ]);
  });

  it("skips an account whose location enumeration fails (non-fatal)", async () => {
    const out = await listGbpAccountsAndLocations("rt", {
      listAccountsPage: async () => ({
        accounts: [
          { name: "accounts/111" },
          { name: "accounts/222" },
        ],
      }),
      listLocationsPage: async (parent) => {
        if (parent === "accounts/111") throw new Error("boom");
        return { locations: [{ name: "locations/9", title: "Survivor" }] };
      },
    });
    expect(out.map((l) => l.id)).toEqual(["locations/9"]);
  });

  it("throws if the top-level accounts.list fails", async () => {
    await expect(
      listGbpAccountsAndLocations("rt", {
        listAccountsPage: async () => {
          throw Object.assign(new Error("401"), { response: { status: 401 } });
        },
      })
    ).rejects.toBeInstanceOf(GoogleApiError);
  });
});
