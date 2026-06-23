import "server-only";
import type { ApprovalQueueRow, Publisher, PublisherRegistry } from "./gate";
import {
  createLocalPost,
  localPostInputSchema,
  type GbpPostDeps,
} from "@/lib/google-oauth/gbp-post";

// PSG-247 / Wave 2 (G-b) — the SERVER-SIDE publisher registry the approve route
// injects into approveApproval(). The pure gate (./gate.ts) keeps a registry but
// stays free of server-only/network imports; the live wiring lives here so the
// gate remains unit-testable with an in-memory fake. Each capability (G-a/b/c)
// registers its publisher here; G-b's is the GBP local post.
//
// A publisher RESOLVES on success (optionally returning an external ref) and
// THROWS to signal a publish failure — the gate maps a throw to status
// `publish_failed` while preserving the recorded approval decision.

/**
 * Publish an approved `gbp_post` row to Google Business Profile. The drafted post
 * lives in `payload_jsonb` (written by the gbp draft route / agent). We re-validate
 * it against the same schema the draft route used (defence in depth — a row could
 * have been enqueued via the generic /api/approvals surface that does no
 * GBP-specific validation), then create the local post on the row's shop.
 *
 * GBP returns an output-only `state`: LIVE (live) / PROCESSING (accepted, going
 * live) / REJECTED (policy rejection). LIVE + PROCESSING are a successful submit;
 * REJECTED is a publish FAILURE (throw → publish_failed) so the queue never shows a
 * policy-rejected post as published.
 */
export function gbpPostPublisher(deps: GbpPostDeps = {}): Publisher {
  return async (row: ApprovalQueueRow) => {
    const parsed = localPostInputSchema.safeParse(row.payload_jsonb);
    if (!parsed.success) {
      throw new Error(
        `gbp_post payload invalid: ${parsed.error.issues
          .map((i) => i.message)
          .join("; ")}`
      );
    }
    const result = await createLocalPost(row.shop_id, parsed.data, deps);
    if (result.state === "REJECTED") {
      throw new Error(
        `Google Business Profile rejected the post${
          result.name ? ` (${result.name})` : ""
        }`
      );
    }
    return { ref: result.name ?? undefined };
  };
}

/** The live registry wired into the approve route. New autonomy capabilities
 *  register their action_type → publisher here. */
export const serverPublishers: PublisherRegistry = {
  gbp_post: gbpPostPublisher(),
};
