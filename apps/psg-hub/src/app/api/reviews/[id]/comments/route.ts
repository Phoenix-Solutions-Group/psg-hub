import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyBsmApprovalAdmins } from "@/lib/bsm/approval-notifications";

type CommentBody = {
  body?: string;
  responseId?: string | null;
};

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

  let body: CommentBody;
  try {
    body = (await request.json()) as CommentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Comment body required" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json(
      { error: "Comment must be 2000 characters or fewer" },
      { status: 400 }
    );
  }

  const { data: review, error: revErr } = await supabase
    .from("review_items")
    .select("id, shop_id, platform, author")
    .eq("id", reviewId)
    .maybeSingle();

  if (revErr) {
    return NextResponse.json({ error: revErr.message }, { status: 500 });
  }
  if (!review) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", review.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const responseId = body.responseId ?? null;
  if (responseId) {
    const { data: response, error: responseErr } = await supabase
      .from("review_responses")
      .select("id, review_id:review_item_id, shop_id")
      .eq("id", responseId)
      .maybeSingle();

    if (responseErr) {
      return NextResponse.json({ error: responseErr.message }, { status: 500 });
    }
    if (
      !response ||
      response.review_id !== reviewId ||
      response.shop_id !== review.shop_id
    ) {
      return NextResponse.json(
        { error: "Response does not belong to this review" },
        { status: 400 }
      );
    }
  }

  const { data: comment, error: insertErr } = await supabase
    .from("review_response_comments")
    .insert({
      review_item_id: reviewId,
      review_response_id: responseId,
      shop_id: review.shop_id,
      body: text,
      created_by: user.id,
    })
    .select("id, review_id:review_item_id, response_id:review_response_id, body, created_at")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("id, name")
    .eq("id", review.shop_id)
    .maybeSingle();

  if (shopErr) {
    console.error("[reviews/comments] shop lookup failed:", shopErr.message);
  }

  try {
    await notifyBsmApprovalAdmins(createServiceClient(), {
      shopId: review.shop_id,
      shopName: shop?.name ?? "Customer shop",
      reviewItemId: reviewId,
      reviewItemTitle: reviewNotificationTitle(review),
      eventKey: `review:${reviewId}:comment:${comment.id}`,
      eventType: "comment_created",
      actorName: "Team member",
      messagePreview: text,
      appBaseUrl: appBaseUrlFromRequest(request),
    });
  } catch (error) {
    console.error(
      "[reviews/comments] BSM approval notification failed:",
      error instanceof Error ? error.message : error,
    );
  }

  return NextResponse.json({
    comment: {
      ...comment,
      author_name: "Team member",
    },
  });
}

function appBaseUrlFromRequest(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

function reviewNotificationTitle(review: {
  platform?: string | null;
  author?: string | null;
}): string {
  const platform = cleanLabel(review.platform) ?? "review";
  const author = cleanLabel(review.author);
  return author ? `${platform} review from ${author}` : `${platform} review`;
}

function cleanLabel(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}
