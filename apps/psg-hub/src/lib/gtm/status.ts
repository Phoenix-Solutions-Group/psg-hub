import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export type GtmWorkspaceStatus = "unknown" | "clean" | "modified" | "published" | "error";

export type GtmTagSummary = {
  tagId: string | null;
  name: string;
  type: string | null;
  paused: boolean;
  firingTriggerIds: string[];
  blockingTriggerIds: string[];
};

export type GtmTriggerSummary = {
  triggerId: string | null;
  name: string;
  type: string | null;
};

export type GtmContainerStatus = {
  shopId: string;
  containerId: string;
  accountName: string | null;
  containerName: string | null;
  workspace: {
    id: string | null;
    name: string | null;
    fingerprint: string | null;
    status: GtmWorkspaceStatus;
  };
  publishedVersion: {
    id: string | null;
    name: string | null;
    fingerprint: string | null;
  };
  tags: GtmTagSummary[];
  triggers: GtmTriggerSummary[];
  lastCheckedAt: string;
};

type GtmStatusRow = {
  shop_id: string;
  container_public_id: string;
  account_name: string | null;
  container_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_fingerprint: string | null;
  workspace_status: string | null;
  published_version_id: string | null;
  published_version_name: string | null;
  published_version_fingerprint: string | null;
  tags_jsonb: unknown;
  triggers_jsonb: unknown;
  last_checked_at: string;
};

const WORKSPACE_STATUSES = new Set<GtmWorkspaceStatus>([
  "unknown",
  "clean",
  "modified",
  "published",
  "error",
]);

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function normalizeWorkspaceStatus(value: unknown): GtmWorkspaceStatus {
  return typeof value === "string" && WORKSPACE_STATUSES.has(value as GtmWorkspaceStatus)
    ? (value as GtmWorkspaceStatus)
    : "unknown";
}

export function normalizeGtmTags(value: unknown): GtmTagSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is Record<string, unknown> => tag !== null && typeof tag === "object" && !Array.isArray(tag))
    .map((tag) => ({
      tagId: stringOrNull(tag.tagId ?? tag.tag_id),
      name: stringOrNull(tag.name) ?? "Unnamed tag",
      type: stringOrNull(tag.type),
      paused: boolValue(tag.paused),
      firingTriggerIds: stringList(tag.firingTriggerId ?? tag.firing_trigger_ids),
      blockingTriggerIds: stringList(tag.blockingTriggerId ?? tag.blocking_trigger_ids),
    }));
}

export function normalizeGtmTriggers(value: unknown): GtmTriggerSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (trigger): trigger is Record<string, unknown> =>
        trigger !== null && typeof trigger === "object" && !Array.isArray(trigger)
    )
    .map((trigger) => ({
      triggerId: stringOrNull(trigger.triggerId ?? trigger.trigger_id),
      name: stringOrNull(trigger.name) ?? "Unnamed trigger",
      type: stringOrNull(trigger.type),
    }));
}

export function normalizeGtmContainerStatus(row: GtmStatusRow): GtmContainerStatus {
  return {
    shopId: row.shop_id,
    containerId: row.container_public_id,
    accountName: row.account_name,
    containerName: row.container_name,
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      fingerprint: row.workspace_fingerprint,
      status: normalizeWorkspaceStatus(row.workspace_status),
    },
    publishedVersion: {
      id: row.published_version_id,
      name: row.published_version_name,
      fingerprint: row.published_version_fingerprint,
    },
    tags: normalizeGtmTags(row.tags_jsonb),
    triggers: normalizeGtmTriggers(row.triggers_jsonb),
    lastCheckedAt: row.last_checked_at,
  };
}

export async function listGtmContainerStatuses(shopId: string): Promise<GtmContainerStatus[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("gtm_container_statuses")
    .select(
      [
        "shop_id",
        "container_public_id",
        "account_name",
        "container_name",
        "workspace_id",
        "workspace_name",
        "workspace_fingerprint",
        "workspace_status",
        "published_version_id",
        "published_version_name",
        "published_version_fingerprint",
        "tags_jsonb",
        "triggers_jsonb",
        "last_checked_at",
      ].join(",")
    )
    .eq("shop_id", shopId)
    .order("last_checked_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to read GTM container statuses: ${error.message}`);
  }

  return ((data ?? []) as unknown as GtmStatusRow[]).map(normalizeGtmContainerStatus);
}
