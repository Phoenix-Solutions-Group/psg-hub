import type { SupabaseClient } from "@supabase/supabase-js";

export type LocalReachStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "publishing"
  | "published"
  | "changes_requested"
  | "rejected"
  | "cancelled";

export type LocalReachRisk = "low" | "medium" | "high";

export type LocalReachEvidence = {
  id: string;
  sourceName: string;
  url: string;
  sourceDate: string;
  summary: string;
};

export type LocalReachRecommendation = {
  id: string;
  createdAt: string;
  title: string;
  type: string;
  status: LocalReachStatus;
  risk: LocalReachRisk;
  market: string;
  sourceDate: string | null;
  valueLine: string;
  summary: string;
  whyItMatters: string;
  businessValue: string;
  targetPage: string | null;
  draftPreview: string | null;
  locationSafetyNote: string;
  approvalItemId: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  verificationNote: string | null;
  evidence: LocalReachEvidence[];
};

export type LocalReachSettings = {
  shopName: string;
  market: string;
  pilotStatus: string;
  lastAuditAt: string | null;
  sourcesCheckedThrough: string | null;
  serviceArea: string[];
  services: string[];
  certifications: string[];
  claimsToAvoid: string[];
  approvalContacts: string[];
  publishingNotes: string | null;
};

export type LocalReachWorkspace = {
  settings: LocalReachSettings;
  recommendations: LocalReachRecommendation[];
  stats: {
    waitingForReview: number;
    approvedWaitingForPublishing: number;
    publishedLast30Days: number;
    needsClarification: number;
    createdLast30Days: number;
  };
  setupSteps: Array<{ label: string; status: "complete" | "pending" }>;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_SETTINGS: LocalReachSettings = {
  shopName: "Supreme Collision",
  market: "Ontario, Canada",
  pilotStatus: "Setup audit in progress",
  lastAuditAt: null,
  sourcesCheckedThrough: null,
  serviceArea: [],
  services: [],
  certifications: [],
  claimsToAvoid: [],
  approvalContacts: [],
  publishingNotes: "Manual WordPress/Elementor publishing only. No automatic live website edits.",
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asStatus(value: unknown): LocalReachStatus {
  if (
    value === "draft" ||
    value === "ready_for_review" ||
    value === "approved" ||
    value === "publishing" ||
    value === "published" ||
    value === "changes_requested" ||
    value === "rejected" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "draft";
}

function asRisk(value: unknown): LocalReachRisk {
  if (value === "medium" || value === "high") return value;
  return "low";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function statusLabel(status: LocalReachStatus): string {
  const labels: Record<LocalReachStatus, string> = {
    draft: "Draft",
    ready_for_review: "Ready for review",
    approved: "Approved, not live",
    publishing: "PSG publishing",
    published: "Published",
    changes_requested: "Changes requested",
    rejected: "Rejected",
    cancelled: "Cancelled",
  };
  return labels[status];
}

export function statusTone(status: LocalReachStatus): "default" | "secondary" | "success" | "destructive" {
  if (status === "published") return "success";
  if (status === "approved" || status === "publishing") return "secondary";
  if (status === "rejected" || status === "cancelled") return "destructive";
  return "default";
}

export function buildLocalReachStats(recommendations: LocalReachRecommendation[]) {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  return {
    waitingForReview: recommendations.filter((item) => item.status === "ready_for_review").length,
    approvedWaitingForPublishing: recommendations.filter((item) => item.status === "approved").length,
    publishedLast30Days: recommendations.filter((item) => {
      if (item.status !== "published" || !item.publishedAt) return false;
      return now - new Date(item.publishedAt).getTime() <= thirtyDaysMs;
    }).length,
    needsClarification: recommendations.filter((item) => item.status === "changes_requested").length,
    createdLast30Days: recommendations.filter((item) => {
      const createdAt = new Date(item.createdAt).getTime();
      if (Number.isNaN(createdAt)) return false;
      const ageMs = now - createdAt;
      return ageMs >= 0 && ageMs <= thirtyDaysMs;
    }).length,
  };
}

export function buildSetupSteps(settings: LocalReachSettings, recommendations: LocalReachRecommendation[]) {
  return [
    { label: "Business facts", status: settings.shopName ? "complete" : "pending" },
    { label: "Approved service area", status: settings.serviceArea.length > 0 ? "complete" : "pending" },
    { label: "Approved services", status: settings.services.length > 0 ? "complete" : "pending" },
    { label: "Public source check", status: settings.sourcesCheckedThrough ? "complete" : "pending" },
    { label: "First recommendation draft", status: recommendations.length > 0 ? "complete" : "pending" },
  ] satisfies LocalReachWorkspace["setupSteps"];
}

export async function getLocalReachWorkspace(
  client: SupabaseClient,
  shopId: string,
): Promise<LocalReachWorkspace> {
  const [settingsResult, recommendationsResult] = await Promise.all([
    client.from("local_reach_customer_settings").select("*").eq("shop_id", shopId).maybeSingle(),
    client
      .from("local_reach_recommendations")
      .select("*")
      .eq("shop_id", shopId)
      .order("priority", { ascending: true })
      .order("updated_at", { ascending: false }),
  ]);

  if (settingsResult.error) {
    throw new Error(`Could not load Local Reach settings: ${settingsResult.error.message}`);
  }
  if (recommendationsResult.error) {
    throw new Error(`Could not load Local Reach recommendations: ${recommendationsResult.error.message}`);
  }

  const recommendationRows = (recommendationsResult.data ?? []) as JsonRecord[];
  const recommendationIds = recommendationRows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  const evidenceByRecommendation = new Map<string, LocalReachEvidence[]>();

  if (recommendationIds.length > 0) {
    const evidenceResult = await client
      .from("local_reach_evidence_links")
      .select("*")
      .in("recommendation_id", recommendationIds)
      .order("source_date", { ascending: false });
    if (evidenceResult.error) {
      throw new Error(`Could not load Local Reach evidence: ${evidenceResult.error.message}`);
    }
    for (const row of (evidenceResult.data ?? []) as JsonRecord[]) {
      const recommendationId = row.recommendation_id;
      if (typeof recommendationId !== "string") continue;
      const evidence: LocalReachEvidence = {
        id: String(row.id),
        sourceName: String(row.source_name ?? "Public source"),
        url: String(row.url ?? ""),
        sourceDate: String(row.source_date ?? row.captured_at ?? ""),
        summary: String(row.summary ?? ""),
      };
      evidenceByRecommendation.set(recommendationId, [
        ...(evidenceByRecommendation.get(recommendationId) ?? []),
        evidence,
      ]);
    }
  }

  const rawSettings = (settingsResult.data ?? {}) as JsonRecord;
  const settings: LocalReachSettings = {
    shopName: asNullableString(rawSettings.shop_name) ?? DEFAULT_SETTINGS.shopName,
    market: asNullableString(rawSettings.market) ?? DEFAULT_SETTINGS.market,
    pilotStatus: asNullableString(rawSettings.pilot_status) ?? DEFAULT_SETTINGS.pilotStatus,
    lastAuditAt: asNullableString(rawSettings.last_audit_at),
    sourcesCheckedThrough: asNullableString(rawSettings.sources_checked_through),
    serviceArea: asStringArray(rawSettings.service_area_jsonb),
    services: asStringArray(rawSettings.services_jsonb),
    certifications: asStringArray(rawSettings.certifications_jsonb),
    claimsToAvoid: asStringArray(rawSettings.claims_to_avoid_jsonb),
    approvalContacts: asStringArray(rawSettings.approval_contacts_jsonb),
    publishingNotes: asNullableString(rawSettings.publishing_notes) ?? DEFAULT_SETTINGS.publishingNotes,
  };

  const recommendations = recommendationRows.map((row): LocalReachRecommendation => {
    const id = String(row.id);
    return {
      id,
      createdAt: String(row.created_at ?? ""),
      title: String(row.title ?? "Untitled recommendation"),
      type: String(row.recommendation_type ?? "Content update"),
      status: asStatus(row.status),
      risk: asRisk(row.risk_level),
      market: String(row.market ?? settings.market),
      sourceDate: asNullableString(row.source_date),
      valueLine: String(row.value_line ?? "Improve local visibility with a customer-approved website update."),
      summary: String(row.summary ?? ""),
      whyItMatters: String(row.why_it_matters ?? ""),
      businessValue: String(row.business_value ?? ""),
      targetPage: asNullableString(row.target_page),
      draftPreview: asNullableString(row.draft_preview),
      locationSafetyNote: String(row.location_safety_note ?? "Uses approved service area and public sources only."),
      approvalItemId: asNullableString(row.approval_item_id),
      publishedUrl: asNullableString(row.published_url),
      publishedAt: asNullableString(row.published_at),
      verificationNote: asNullableString(row.verification_note),
      evidence: evidenceByRecommendation.get(id) ?? [],
    };
  });

  return {
    settings,
    recommendations,
    stats: buildLocalReachStats(recommendations),
    setupSteps: buildSetupSteps(settings, recommendations),
  };
}
