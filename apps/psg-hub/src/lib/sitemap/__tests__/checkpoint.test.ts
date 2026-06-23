import { describe, it, expect } from "vitest";
import {
  hashCheckpoint,
  makeCheckpointGate,
  type CheckpointRecord,
  type CheckpointStore,
} from "../checkpoint";
import type {
  ClusterCheckpointPayload,
  PackageCheckpointPayload,
} from "../pipeline";
import type { SerpCluster, SitemapPackage } from "../types";

/* ----------------------------- fixtures -------------------------------- */

function cluster(id: string, label: string, keywords: string[]): SerpCluster {
  return {
    id,
    label,
    intent: "transactional",
    pageType: "service",
    personaIds: [],
    priority: 50,
    keywords: keywords.map((k) => ({ keyword: k, intent: "transactional", source: "baseline" })),
  } as unknown as SerpCluster;
}

const clusterPayload: ClusterCheckpointPayload = {
  phase: "clusters_page_types",
  clusters: [cluster("c1", "Collision Repair", ["collision repair", "auto body repair"])],
  inventory: [{ url: "https://shop.example/services", title: "Services", disposition: "keep" }],
};

const draft: SitemapPackage = {
  brief: {
    shopId: "shop-1",
    businessName: "Demo Body Shop",
    domain: null,
    vertical: "collision_repair",
    services: [],
    locations: [],
    competitors: [],
  },
  generatedAt: "2026-06-23T00:00:00.000Z",
  vertical: "collision_repair",
  root: { slug: "", pageType: "home", title: "Home", disposition: "improve", priority: 50, intent: "informational", keywords: [], internalLinks: [], children: [] } as unknown as SitemapPackage["root"],
  clusters: clusterPayload.clusters,
  calendar: { pagesPerMonth: 4, entries: [] },
  validation: { threeClickViolations: [], duplicateSlugPaths: [], brokenInternalLinks: [], coverageGaps: [], ok: true },
  inventory: clusterPayload.inventory,
  checkpoints: [],
};

const packagePayload: PackageCheckpointPayload = { phase: "package_handoff", draft };

/* ----------------------- in-memory store ------------------------------- */

function memStore(seed: CheckpointRecord[] = []): CheckpointStore & { records: CheckpointRecord[] } {
  const records: CheckpointRecord[] = [...seed];
  const key = (s: string, p: string, h: string) => `${s}|${p}|${h}`;
  return {
    records,
    async get(shopId, phase, contentHash) {
      return records.find((r) => key(r.shop_id, r.phase, r.content_hash) === key(shopId, phase, contentHash)) ?? null;
    },
    async upsertPending(rec) {
      const existing = await this.get(rec.shop_id, rec.phase, rec.content_hash);
      if (existing) return existing; // ON CONFLICT DO NOTHING — preserve a decision
      const stored = { ...rec, id: `cp-${records.length + 1}` };
      records.push(stored);
      return stored;
    },
  };
}

const NOW = "2026-06-23T12:00:00.000Z";

/* ------------------------------ tests ---------------------------------- */

describe("hashCheckpoint", () => {
  it("is stable across calls and key order", () => {
    expect(hashCheckpoint(clusterPayload)).toBe(hashCheckpoint(clusterPayload));
  });

  it("ignores keyword ordering within a cluster (sorted projection)", () => {
    const reordered: ClusterCheckpointPayload = {
      ...clusterPayload,
      clusters: [cluster("c1", "Collision Repair", ["auto body repair", "collision repair"])],
    };
    expect(hashCheckpoint(reordered)).toBe(hashCheckpoint(clusterPayload));
  });

  it("changes when a page type changes", () => {
    const changed: ClusterCheckpointPayload = {
      ...clusterPayload,
      clusters: [{ ...clusterPayload.clusters[0], pageType: "location" } as unknown as SerpCluster],
    };
    expect(hashCheckpoint(changed)).not.toBe(hashCheckpoint(clusterPayload));
  });

  it("differs between the two phases", () => {
    expect(hashCheckpoint(clusterPayload)).not.toBe(hashCheckpoint(packagePayload));
  });
});

describe("makeCheckpointGate — poll-based gate", () => {
  it("queues a PENDING row and halts on first reach (no prior decision)", async () => {
    const store = memStore();
    const gate = makeCheckpointGate({ store, shopId: "shop-1", requestedByProfileId: "super-1", now: () => NOW });

    const approval = await gate.handler(clusterPayload);

    expect(approval.decision).toBe("changes_requested");
    const stop = gate.getStop();
    expect(stop?.kind).toBe("pending");
    expect(stop?.phase).toBe("clusters_page_types");
    expect(store.records).toHaveLength(1);
    expect(store.records[0].status).toBe("pending");
    expect(store.records[0].requested_by_profile_id).toBe("super-1");
    expect(store.records[0].summary.clusterCount).toBe(1);
  });

  it("proceeds when the exact plan was approved", async () => {
    const hash = hashCheckpoint(clusterPayload);
    const store = memStore([
      {
        shop_id: "shop-1",
        phase: "clusters_page_types",
        content_hash: hash,
        status: "approved",
        summary: {},
        decided_by_profile_id: "boss-1",
        decided_by_name: "The Boss",
        decided_at: "2026-06-23T11:00:00.000Z",
        notes: "looks good",
        requested_by_profile_id: "super-1",
      },
    ]);
    const gate = makeCheckpointGate({ store, shopId: "shop-1", requestedByProfileId: "super-1", now: () => NOW });

    const approval = await gate.handler(clusterPayload);

    expect(approval.decision).toBe("approved");
    expect(approval.approvedBy).toBe("The Boss");
    expect(gate.getStop()).toBeNull(); // an approved gate does not stop the run
  });

  it("stops as 'rejected' when a human requested changes", async () => {
    const hash = hashCheckpoint(clusterPayload);
    const store = memStore([
      {
        shop_id: "shop-1",
        phase: "clusters_page_types",
        content_hash: hash,
        status: "changes_requested",
        summary: {},
        decided_by_profile_id: "boss-1",
        decided_by_name: "The Boss",
        decided_at: "2026-06-23T11:00:00.000Z",
        notes: "merge the two service clusters",
        requested_by_profile_id: "super-1",
      },
    ]);
    const gate = makeCheckpointGate({ store, shopId: "shop-1", requestedByProfileId: "super-1", now: () => NOW });

    const approval = await gate.handler(clusterPayload);

    expect(approval.decision).toBe("changes_requested");
    expect(approval.notes).toBe("merge the two service clusters");
    expect(gate.getStop()?.kind).toBe("rejected");
  });

  it("does not double-queue a pending gate (idempotent on re-run)", async () => {
    const store = memStore();
    const g1 = makeCheckpointGate({ store, shopId: "shop-1", requestedByProfileId: "super-1", now: () => NOW });
    await g1.handler(clusterPayload);
    const g2 = makeCheckpointGate({ store, shopId: "shop-1", requestedByProfileId: "super-1", now: () => NOW });
    await g2.handler(clusterPayload);
    expect(store.records).toHaveLength(1);
  });
});
