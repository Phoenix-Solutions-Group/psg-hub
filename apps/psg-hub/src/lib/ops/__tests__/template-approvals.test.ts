import { describe, it, expect, beforeEach } from "vitest";
import {
  ApprovalTransitionError,
  approveTemplateVersion,
  releaseTemplateVersion,
  revokeTemplateVersion,
  type ApprovalStore,
  type TemplateApprovalRow,
} from "../template-approvals";
import { isTemplateEligibleForLiveBatch } from "@/lib/production/template-gate";

/** In-memory ApprovalStore keyed by `${template_key}::${content_hash}`. */
function memoryStore(): ApprovalStore & { rows: Map<string, TemplateApprovalRow> } {
  const rows = new Map<string, TemplateApprovalRow>();
  const k = (key: string, hash: string) => `${key}::${hash}`;
  return {
    rows,
    async get(templateKey, contentHash) {
      return rows.get(k(templateKey, contentHash)) ?? null;
    },
    async save(row) {
      const stored = { ...row, id: row.id ?? "row-1" };
      rows.set(k(row.template_key, row.content_hash), stored);
      return stored;
    },
    async listByKeys(keys) {
      return [...rows.values()].filter((r) => keys.includes(r.template_key));
    },
  };
}

const NOW = "2026-06-23T12:00:00.000Z";
const KEY = "warranty";
const HASH = "deadbeef";

describe("approveTemplateVersion", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("creates an approved row with named sign-off (who/when)", async () => {
    const row = await approveTemplateVersion(store, {
      templateKey: KEY,
      contentHash: HASH,
      actorProfileId: "profile-1",
      approverName: "Ada Lovelace",
      now: NOW,
    });
    expect(row.status).toBe("approved");
    expect(row.approved_by_profile_id).toBe("profile-1");
    expect(row.approved_by_name).toBe("Ada Lovelace");
    expect(row.approved_at).toBe(NOW);
    expect(row.content_hash).toBe(HASH);
  });

  it("re-approving clears a prior revocation", async () => {
    await approveTemplateVersion(store, {
      templateKey: KEY, contentHash: HASH, actorProfileId: "p1", approverName: "A", now: NOW,
    });
    await revokeTemplateVersion(store, { templateKey: KEY, contentHash: HASH, actorProfileId: "p1", now: NOW });
    const row = await approveTemplateVersion(store, {
      templateKey: KEY, contentHash: HASH, actorProfileId: "p2", approverName: "B", now: NOW,
    });
    expect(row.status).toBe("approved");
    expect(row.revoked_at).toBeNull();
    expect(row.revoked_by_profile_id).toBeNull();
  });
});

describe("releaseTemplateVersion", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("requires an approved row first", async () => {
    await expect(
      releaseTemplateVersion(store, { templateKey: KEY, contentHash: HASH, actorProfileId: "p1", now: NOW })
    ).rejects.toBeInstanceOf(ApprovalTransitionError);
  });

  it("releases an approved version and records who/when", async () => {
    await approveTemplateVersion(store, {
      templateKey: KEY, contentHash: HASH, actorProfileId: "p1", approverName: "A", now: NOW,
    });
    const row = await releaseTemplateVersion(store, {
      templateKey: KEY, contentHash: HASH, actorProfileId: "p2", now: "2026-06-23T13:00:00.000Z",
    });
    expect(row.status).toBe("released");
    expect(row.released_by_profile_id).toBe("p2");
    expect(row.released_at).toBe("2026-06-23T13:00:00.000Z");
    // The named sign-off is preserved through release.
    expect(row.approved_by_name).toBe("A");
  });
});

describe("revokeTemplateVersion", () => {
  it("rejects revoking a non-existent approval", async () => {
    const store = memoryStore();
    await expect(
      revokeTemplateVersion(store, { templateKey: KEY, contentHash: HASH, actorProfileId: "p1", now: NOW })
    ).rejects.toBeInstanceOf(ApprovalTransitionError);
  });
});

describe("end-to-end gate: draft → approve → release → eligible", () => {
  it("a template is eligible for a live batch only after approve + release", async () => {
    const store = memoryStore();
    const state = async () => {
      const r = await store.get(KEY, HASH);
      return r ? { templateKey: KEY, contentHash: r.content_hash, status: r.status } : null;
    };

    // No approval → not eligible.
    expect(isTemplateEligibleForLiveBatch(await state(), HASH)).toBe(false);

    // Approved only → still not eligible.
    await approveTemplateVersion(store, {
      templateKey: KEY, contentHash: HASH, actorProfileId: "p1", approverName: "A", now: NOW,
    });
    expect(isTemplateEligibleForLiveBatch(await state(), HASH)).toBe(false);

    // Released → eligible (for the matching hash only).
    await releaseTemplateVersion(store, { templateKey: KEY, contentHash: HASH, actorProfileId: "p1", now: NOW });
    expect(isTemplateEligibleForLiveBatch(await state(), HASH)).toBe(true);
    // …but not for a changed template (different hash).
    expect(isTemplateEligibleForLiveBatch(await state(), "other-hash")).toBe(false);

    // Revoked → no longer eligible.
    await revokeTemplateVersion(store, { templateKey: KEY, contentHash: HASH, actorProfileId: "p1", now: NOW });
    expect(isTemplateEligibleForLiveBatch(await state(), HASH)).toBe(false);
  });
});
