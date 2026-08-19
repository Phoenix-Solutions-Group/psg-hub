import { describe, expect, it } from "vitest";
import { normalizeGtmContainerStatus } from "@/lib/gtm/status";

describe("normalizeGtmContainerStatus", () => {
  it("maps the minimum per-shop GTM inventory into the BSM readiness shape", () => {
    const status = normalizeGtmContainerStatus({
      shop_id: "shop-1",
      container_public_id: "GTM-PSG123",
      account_name: "PSG",
      container_name: "Wallace site",
      workspace_id: "12",
      workspace_name: "Default Workspace",
      workspace_fingerprint: "abc123",
      workspace_status: "modified",
      published_version_id: "7",
      published_version_name: "Lead tracking",
      published_version_fingerprint: "pub456",
      tags_jsonb: [
        {
          tagId: "100",
          name: "GA4 event - qualify_lead",
          type: "gaawe",
          paused: false,
          firingTriggerId: ["200"],
          blockingTriggerId: ["300"],
        },
        { name: "Paused duplicate pageview", paused: "true" },
      ],
      triggers_jsonb: [{ triggerId: "200", name: "Lead form submit", type: "customEvent" }],
      last_checked_at: "2026-07-10T20:00:00.000Z",
    });

    expect(status).toEqual({
      shopId: "shop-1",
      containerId: "GTM-PSG123",
      accountName: "PSG",
      containerName: "Wallace site",
      workspace: {
        id: "12",
        name: "Default Workspace",
        fingerprint: "abc123",
        status: "modified",
      },
      publishedVersion: {
        id: "7",
        name: "Lead tracking",
        fingerprint: "pub456",
      },
      tags: [
        {
          tagId: "100",
          name: "GA4 event - qualify_lead",
          type: "gaawe",
          paused: false,
          firingTriggerIds: ["200"],
          blockingTriggerIds: ["300"],
        },
        {
          tagId: null,
          name: "Paused duplicate pageview",
          type: null,
          paused: true,
          firingTriggerIds: [],
          blockingTriggerIds: [],
        },
      ],
      triggers: [{ triggerId: "200", name: "Lead form submit", type: "customEvent" }],
      lastCheckedAt: "2026-07-10T20:00:00.000Z",
    });
  });

  it("falls back safely when fixture JSON is missing or unexpected", () => {
    const status = normalizeGtmContainerStatus({
      shop_id: "shop-1",
      container_public_id: "GTM-PSG123",
      account_name: null,
      container_name: null,
      workspace_id: null,
      workspace_name: null,
      workspace_fingerprint: null,
      workspace_status: "surprising",
      published_version_id: null,
      published_version_name: null,
      published_version_fingerprint: null,
      tags_jsonb: { not: "an array" },
      triggers_jsonb: null,
      last_checked_at: "2026-07-10T20:00:00.000Z",
    });

    expect(status.workspace.status).toBe("unknown");
    expect(status.tags).toEqual([]);
    expect(status.triggers).toEqual([]);
  });
});

