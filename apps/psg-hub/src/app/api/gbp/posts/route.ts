// PSG-247 / Wave 2 (G-b) — draft a Google Business Profile local post and queue it
// for human approval. POST { shopId, summary, callToAction?, languageCode?,
// proposedBy? } → a `pending` approval_queue row (action_type `gbp_post`). On
// approve, the PSG-245 gate publishes it to GBP via the gbp_post publisher.
//
// This is the GBP-SPECIFIC draft surface (vs. the generic /api/approvals enqueue):
// it validates the local-post payload up front (summary ≤1500 chars, CTA/url
// coupling) and refuses to queue a post for a shop with no linked GBP location, so
// an invalid or un-publishable draft never sits in the queue waiting to fail at
// approve time. Role-gated to owner/manager on the shop (per-shop tenant isolation).
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ApprovalDecisionError,
  enqueueApproval,
  supabaseApprovalQueueStore,
} from "@/lib/ops/approval-queue";
import { localPostInputSchema } from "@/lib/google-oauth/gbp-post";
import { getLinkedAccount } from "@/lib/google-oauth/accounts";

// The request envelope (shop + queue-card metadata). The drafted post itself
// (summary, languageCode, callToAction) is validated SEPARATELY by the shared
// localPostInputSchema so the draft route and the publisher agree on the contract —
// validating the two schemas independently avoids Zod-intersection quirks with the
// schema's superRefine + languageCode default.
const envelopeSchema = z.object({
  shopId: z.string().uuid(),
  // A short human-facing label for the queue card; defaults from the summary.
  title: z.string().trim().min(1).max(300).optional(),
  proposedBy: z.string().trim().max(200).nullish(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const env = envelopeSchema.safeParse(body);
  const postParsed = localPostInputSchema.safeParse(body);
  if (!env.success || !postParsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: {
          ...(env.success ? {} : env.error.flatten().fieldErrors),
          ...(postParsed.success ? {} : postParsed.error.flatten().fieldErrors),
        },
      },
      { status: 422 }
    );
  }
  const { shopId, title, proposedBy } = env.data;
  const post = postParsed.data;

  // Role gate: only an owner/manager on the target shop may queue a post there.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!membership || (membership.role !== "owner" && membership.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Refuse to queue a post the shop can't publish: require a linked GBP location.
  // 409 (not 422) — the draft is valid, the shop just needs to connect GBP first.
  const linked = await getLinkedAccount(shopId, "gbp");
  if (!linked) {
    return NextResponse.json(
      { error: "Connect Google Business Profile before drafting a post" },
      { status: 409 }
    );
  }

  // Title defaults to a trimmed slice of the summary so the queue card is readable.
  const cardTitle =
    title ??
    (post.summary.length > 80 ? `${post.summary.slice(0, 77)}…` : post.summary);

  const store = supabaseApprovalQueueStore(createServiceClient());
  try {
    const row = await enqueueApproval(store, {
      shopId,
      actionType: "gbp_post",
      title: cardTitle,
      summary: post.summary,
      payload: post, // { summary, languageCode, callToAction? } — the publisher's input
      proposedBy: proposedBy ?? null,
    });
    return NextResponse.json({ approval: row }, { status: 201 });
  } catch (error) {
    if (error instanceof ApprovalDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error(
      "[gbp/posts] enqueue failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Failed to queue post" }, { status: 500 });
  }
}
