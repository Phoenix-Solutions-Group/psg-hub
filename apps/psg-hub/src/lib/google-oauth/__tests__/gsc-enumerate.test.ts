import { describe, it, expect } from "vitest";
import { listGscSites } from "@/lib/google-oauth/gsc-enumerate";
import { GoogleApiError } from "@/lib/google-oauth/client";

// The deps.listSites seam injects the sites.list body; the default googleapis
// client never runs.

describe("listGscSites", () => {
  it("maps siteUrl to {id,name,permissionLevel} (siteUrl is both id and label)", async () => {
    const out = await listGscSites("rt", {
      listSites: async () => ({
        siteEntry: [
          { siteUrl: "sc-domain:acme.com", permissionLevel: "siteOwner" },
          {
            siteUrl: "https://www.acme.com/",
            permissionLevel: "siteFullUser",
          },
        ],
      }),
    });
    expect(out).toEqual([
      {
        id: "sc-domain:acme.com",
        name: "sc-domain:acme.com",
        permissionLevel: "siteOwner",
      },
      {
        id: "https://www.acme.com/",
        name: "https://www.acme.com/",
        permissionLevel: "siteFullUser",
      },
    ]);
  });

  it("EXCLUDES siteUnverifiedUser sites (they 403 on query)", async () => {
    const out = await listGscSites("rt", {
      listSites: async () => ({
        siteEntry: [
          { siteUrl: "sc-domain:ok.com", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:nope.com", permissionLevel: "siteUnverifiedUser" },
          { siteUrl: "https://restricted.com/", permissionLevel: "siteRestrictedUser" },
        ],
      }),
    });
    expect(out.map((s) => s.id)).toEqual([
      "sc-domain:ok.com",
      "https://restricted.com/",
    ]);
  });

  it("skips blank siteUrls + de-dupes", async () => {
    const out = await listGscSites("rt", {
      listSites: async () => ({
        siteEntry: [
          { siteUrl: "", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:dupe.com", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:dupe.com", permissionLevel: "siteFullUser" },
        ],
      }),
    });
    expect(out).toEqual([
      {
        id: "sc-domain:dupe.com",
        name: "sc-domain:dupe.com",
        permissionLevel: "siteOwner",
      },
    ]);
  });

  it("empty / missing siteEntry -> []", async () => {
    expect(await listGscSites("rt", { listSites: async () => ({}) })).toEqual([]);
  });

  it("maps a Gaxios error (HTTP status) to a GoogleApiError", async () => {
    // Realistic Gaxios error: HTTP status on .response.status (403 -> auth_failed).
    const gaxios = Object.assign(
      new Error("Request failed with status code 403"),
      { code: "ERR_BAD_REQUEST", response: { status: 403 } }
    );
    await expect(
      listGscSites("rt", {
        listSites: async () => {
          throw gaxios;
        },
      })
    ).rejects.toMatchObject({ code: "auth_failed" });
    await expect(
      listGscSites("rt", {
        listSites: async () => {
          throw gaxios;
        },
      })
    ).rejects.toBeInstanceOf(GoogleApiError);
  });
});
