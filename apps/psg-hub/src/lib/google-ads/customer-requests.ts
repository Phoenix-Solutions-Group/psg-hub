import { z } from "zod";

export const GOOGLE_ADS_REQUEST_TYPES = [
  "budget_change",
  "campaign_status_change",
  "new_campaign",
  "ad_copy_change",
  "location_change",
  "destination_change",
  "performance_review",
  "problem_report",
] as const;

export const GOOGLE_ADS_REQUEST_STATUSES = [
  "submitted",
  "psg_reviewing",
  "needs_more_info",
  "in_progress",
  "done",
  "declined",
] as const;

export type GoogleAdsRequestType = (typeof GOOGLE_ADS_REQUEST_TYPES)[number];
export type GoogleAdsRequestStatus = (typeof GOOGLE_ADS_REQUEST_STATUSES)[number];

export const RIVERSIDE_PREVIEW_CAMPAIGN_IDS = [
  "riverside-search",
  "riverside-local",
  "riverside-brand",
] as const;

const campaignIdSchema = z.string().refine(
  (value) =>
    z.uuid().safeParse(value).success ||
    RIVERSIDE_PREVIEW_CAMPAIGN_IDS.some((previewId) => previewId === value),
  { message: "Campaign must be a valid campaign ID" },
);

const requestValueSchema = z.record(
  z.string().trim().min(1).max(80),
  z.union([z.string().trim().max(2000), z.number().finite(), z.boolean(), z.null()]),
);

export const createGoogleAdsRequestSchema = z.object({
  requestType: z.enum(GOOGLE_ADS_REQUEST_TYPES),
  campaignId: campaignIdSchema.nullish(),
  campaignName: z.string().trim().max(200).nullish(),
  title: z.string().trim().min(3).max(160),
  details: z.string().trim().min(10).max(5000),
  desiredLaunchDate: z.string().date().nullish(),
  budgetNotes: z.string().trim().max(1000).nullish(),
  requestValues: requestValueSchema,
  acknowledged: z.literal(true),
});

export const updateGoogleAdsRequestSchema = z
  .object({
    status: z.enum(GOOGLE_ADS_REQUEST_STATUSES).optional(),
    response: z.string().trim().min(1).max(5000).optional(),
    declineReason: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((value) => value.status || value.response || value.declineReason, {
    message: "At least one update field is required",
  })
  .refine((value) => value.status !== "declined" || value.declineReason, {
    message: "declineReason is required when declining a request",
    path: ["declineReason"],
  });

export const customerGoogleAdsRequestReplySchema = z.object({
  response: z.string().trim().min(3).max(5000),
});

export const GOOGLE_ADS_REQUEST_SELECT =
  "id, shop_id, requested_by_profile_id, request_type, campaign_id, campaign_name, " +
  "title, details, desired_launch_date, budget_notes, status, psg_response, " +
  "decline_reason, request_values, acknowledged_at, updated_by_profile_id, resolved_at, created_at, updated_at";

export function isTerminalGoogleAdsRequestStatus(
  status: GoogleAdsRequestStatus | undefined,
): boolean {
  return status === "done" || status === "declined";
}

export function toCreateRow(
  shopId: string,
  actorProfileId: string,
  input: z.infer<typeof createGoogleAdsRequestSchema>,
) {
  const campaignId = RIVERSIDE_PREVIEW_CAMPAIGN_IDS.some(
    (previewId) => previewId === input.campaignId,
  )
    ? null
    : input.campaignId ?? null;

  return {
    shop_id: shopId,
    requested_by_profile_id: actorProfileId,
    request_type: input.requestType,
    // Preview campaigns are display-only and have no tenant database row to reference.
    campaign_id: campaignId,
    campaign_name: input.campaignName || null,
    title: input.title,
    details: input.details,
    desired_launch_date: input.desiredLaunchDate ?? null,
    budget_notes: input.budgetNotes || null,
    request_values: input.requestValues,
    acknowledged_at: new Date().toISOString(),
    status: "submitted" satisfies GoogleAdsRequestStatus,
  };
}
