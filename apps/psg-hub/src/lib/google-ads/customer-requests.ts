import { z } from "zod";

export const GOOGLE_ADS_REQUEST_TYPES = [
  "campaign_adjustment",
  "new_campaign",
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

export const createGoogleAdsRequestSchema = z.object({
  requestType: z.enum(GOOGLE_ADS_REQUEST_TYPES),
  campaignId: z.string().uuid().nullish(),
  campaignName: z.string().trim().max(200).nullish(),
  title: z.string().trim().min(3).max(160),
  details: z.string().trim().min(10).max(5000),
  desiredLaunchDate: z.string().date().nullish(),
  budgetNotes: z.string().trim().max(1000).nullish(),
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

export const GOOGLE_ADS_REQUEST_SELECT =
  "id, shop_id, requested_by_profile_id, request_type, campaign_id, campaign_name, " +
  "title, details, desired_launch_date, budget_notes, status, psg_response, " +
  "decline_reason, updated_by_profile_id, resolved_at, created_at, updated_at";

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
  return {
    shop_id: shopId,
    requested_by_profile_id: actorProfileId,
    request_type: input.requestType,
    campaign_id: input.campaignId ?? null,
    campaign_name: input.campaignName || null,
    title: input.title,
    details: input.details,
    desired_launch_date: input.desiredLaunchDate ?? null,
    budget_notes: input.budgetNotes || null,
    status: "submitted" satisfies GoogleAdsRequestStatus,
  };
}
