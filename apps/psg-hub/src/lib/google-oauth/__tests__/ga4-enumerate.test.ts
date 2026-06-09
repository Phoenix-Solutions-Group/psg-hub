import { describe, it, expect } from "vitest";
import {
  listGa4Properties,
  type AccountSummaryLike,
} from "@/lib/google-oauth/ga4-enumerate";
import { GoogleApiError } from "@/lib/google-oauth/client";

// The deps.summaries seam injects a stream of account summaries; the default
// gax client (AnalyticsAdminServiceClient.listAccountSummariesAsync) never runs.

async function* stream(
  summaries: AccountSummaryLike[]
): AsyncIterable<AccountSummaryLike> {
  for (const s of summaries) yield s;
}

describe("listGa4Properties", () => {
  it("maps property summaries to {id,name,account} (ids stay 'properties/...')", async () => {
    const out = await listGa4Properties("rt", {
      summaries: () =>
        stream([
          {
            displayName: "Acme Inc",
            propertySummaries: [
              { property: "properties/111", displayName: "Acme Web" },
              { property: "properties/222", displayName: "Acme App" },
            ],
          },
        ]),
    });
    expect(out).toEqual([
      { id: "properties/111", name: "Acme Web", account: "Acme Inc" },
      { id: "properties/222", name: "Acme App", account: "Acme Inc" },
    ]);
  });

  it("flattens across MULTIPLE summaries (pagination spans the async iterator)", async () => {
    const out = await listGa4Properties("rt", {
      summaries: () =>
        stream([
          {
            displayName: "Acct A",
            propertySummaries: [{ property: "properties/1", displayName: "A1" }],
          },
          {
            displayName: "Acct B",
            propertySummaries: [
              { property: "properties/2", displayName: "B1" },
              { property: "properties/3", displayName: "B2" },
            ],
          },
        ]),
    });
    expect(out.map((p) => p.id)).toEqual([
      "properties/1",
      "properties/2",
      "properties/3",
    ]);
    expect(out[2]).toEqual({
      id: "properties/3",
      name: "B2",
      account: "Acct B",
    });
  });

  it("falls back to the id when a property has no displayName, and skips non-'properties/' ids + dupes", async () => {
    const out = await listGa4Properties("rt", {
      summaries: () =>
        stream([
          {
            displayName: "  ",
            propertySummaries: [
              { property: "properties/9", displayName: null },
              { property: "G-ABC123", displayName: "measurement-id-not-a-property" },
              { property: "properties/9", displayName: "dupe" },
            ],
          },
        ]),
    });
    expect(out).toEqual([
      { id: "properties/9", name: "properties/9", account: "" },
    ]);
  });

  it("maps a gax ServiceError thrown by the stream to a GoogleApiError", async () => {
    // Realistic gax ServiceError: numeric gRPC code (7 = PERMISSION_DENIED).
    const gaxErr = Object.assign(
      new Error("7 PERMISSION_DENIED: Admin API not enabled for project"),
      { code: 7 }
    );
    await expect(
      listGa4Properties("rt", {
        summaries: () =>
          (async function* () {
            throw gaxErr;
          })(),
      })
    ).rejects.toMatchObject({ code: "auth_failed" });

    await expect(
      listGa4Properties("rt", {
        summaries: () =>
          (async function* () {
            throw gaxErr;
          })(),
      })
    ).rejects.toBeInstanceOf(GoogleApiError);
  });
});
