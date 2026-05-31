import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { draftResponse, TimeoutError } from "@/lib/reviews/responder";
import {
  assertWithinLimits,
  RateLimitError,
} from "@/lib/reviews/rate-limit";
import { logLLMCall } from "@/lib/logging/llm-call";
import type { ReviewResponseTone } from "@/lib/reviews/prompts";
import type { ReviewPlatform } from "@/lib/reviews/types";

const VALID_TONES: ReviewResponseTone[] = [
  "default",
  "warm",
  "concise",
  "apologetic",
];

type DraftBody = { tone?: ReviewResponseTone };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DraftBody = {};
  try {
    const raw = await request.text();
    if (raw.length > 0) body = JSON.parse(raw) as DraftBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tone: ReviewResponseTone =
    body.tone && VALID_TONES.includes(body.tone) ? body.tone : "default";

  // Explicit tenancy check — do not rely on RLS returning empty to signal 403.
  const { data: review, error: revErr } = await supabase
    .from("reviews")
    .select("id, shop_id, platform, rating, body, author")
    .eq("id", reviewId)
    .maybeSingle();

  if (revErr) {
    return NextResponse.json({ error: revErr.message }, { status: 500 });
  }
  if (!review) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("shop_members")
    .select("role")
    .eq("profile_id", user.id)
    .eq("shop_id", review.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate-limit check (before Anthropic call)
  try {
    await assertWithinLimits({
      userId: user.id,
      shopId: review.shop_id,
      reviewId,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      await logLLMCall({
        userId: user.id,
        shopId: review.shop_id,
        reviewId,
        purpose: "review_response_draft",
        result: "rate_limited",
        errorCode: err.scope,
      });
      return NextResponse.json(
        { error: err.message, scope: err.scope },
        { status: 429 }
      );
    }
    throw err;
  }

  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("id, name")
    .eq("id", review.shop_id)
    .single();

  if (shopErr || !shop) {
    return NextResponse.json(
      { error: "Shop lookup failed" },
      { status: 500 }
    );
  }

  const started = Date.now();
  let draft;
  try {
    draft = await draftResponse({
      review: {
        platform: review.platform as ReviewPlatform,
        rating: review.rating,
        body: review.body,
        author: review.author,
      },
      shopName: shop.name,
      tone,
    });
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof TimeoutError) {
      await logLLMCall({
        userId: user.id,
        shopId: review.shop_id,
        reviewId,
        purpose: "review_response_draft",
        latencyMs,
        result: "timeout",
      });
      return NextResponse.json(
        { error: "Draft request timed out" },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    await logLLMCall({
      userId: user.id,
      shopId: review.shop_id,
      reviewId,
      purpose: "review_response_draft",
      latencyMs,
      result: "error",
      errorCode: message.slice(0, 120),
    });
    return NextResponse.json({ error: "Draft failed" }, { status: 500 });
  }

  const latencyMs = Date.now() - started;
  await logLLMCall({
    userId: user.id,
    shopId: review.shop_id,
    reviewId,
    purpose: "review_response_draft",
    modelId: draft.modelId,
    inputTokens: draft.usage.input_tokens,
    outputTokens: draft.usage.output_tokens,
    latencyMs,
    result: "success",
  });

  // Upsert via service-role. Increment version on conflict so version history trigger fires.
  const service = createServiceClient();

  // Read existing version so we can compute the next one.
  const { data: existing } = await service
    .from("review_responses")
    .select("id, version")
    .eq("review_id", reviewId)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;

  const { data: row, error: upErr } = await service
    .from("review_responses")
    .upsert(
      {
        review_id: reviewId,
        shop_id: review.shop_id,
        body: draft.body,
        status: "draft",
        tone_preset: tone,
        model_id: draft.modelId,
        prompt_version: draft.promptVersion,
        version: nextVersion,
        safety_flags: draft.safety.flags,
        safety_overridden: false,
        safety_overridden_by: null,
        created_by: existing ? undefined : user.id,
        approved_by: null,
        approved_at: null,
      },
      { onConflict: "review_id" }
    )
    .select(
      "id, review_id, shop_id, body, status, tone_preset, model_id, prompt_version, version, safety_flags, safety_overridden, approved_by, approved_at, created_at, updated_at"
    )
    .single();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    response: row,
    safety: draft.safety,
    usage: draft.usage,
  });
}
