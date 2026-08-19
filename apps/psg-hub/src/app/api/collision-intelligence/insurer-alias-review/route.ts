import { NextResponse } from "next/server";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const destination = "/dashboard/collision-intelligence/review";
const canonicalKeyPattern = /^[a-z0-9]+(?: [a-z0-9]+)*$/;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function redirectToQueue(request: Request, result: string) {
  const url = new URL(destination, request.url);
  url.searchParams.set("result", result);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getDashboardAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const sourceLabel = text(formData, "source_label_normalized");
  const action = text(formData, "action");
  const canonicalKey = text(formData, "canonical_insurer_key");
  const canonicalName = text(formData, "canonical_insurer_name");
  const notes = text(formData, "review_notes");

  if (!sourceLabel || sourceLabel.length > 300) {
    return NextResponse.json(
      { error: "Invalid source label" },
      { status: 400 },
    );
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (notes.length > 1000) {
    return NextResponse.json({ error: "Notes are too long" }, { status: 400 });
  }
  if (
    action === "approve" &&
    (!canonicalKeyPattern.test(canonicalKey) ||
      canonicalKey.length > 200 ||
      !canonicalName ||
      canonicalName.length > 200)
  ) {
    return NextResponse.json(
      { error: "A valid canonical key and name are required" },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: evidence, error: evidenceError } = await service
    .from("v_collision_insurer_alias_review_queue")
    .select("source_label_normalized")
    .eq("source_label_normalized", sourceLabel)
    .maybeSingle();
  if (evidenceError) {
    console.error(
      "[insurer-alias-review] evidence lookup failed:",
      evidenceError.message,
    );
    return redirectToQueue(request, "error");
  }
  if (!evidence) {
    return NextResponse.json(
      { error: "Source label not found" },
      { status: 404 },
    );
  }

  // New labels can arrive after the initial review-table seed. Insert only the
  // candidate key; ignore an existing row so concurrent decisions are preserved.
  const { error: seedError } = await service
    .from("collision_insurer_alias_reviews")
    .upsert(
      { source_label_normalized: sourceLabel },
      { onConflict: "source_label_normalized", ignoreDuplicates: true },
    );
  if (seedError) {
    console.error(
      "[insurer-alias-review] candidate seed failed:",
      seedError.message,
    );
    return redirectToQueue(request, "error");
  }

  const reviewedAt = new Date().toISOString();
  const patch =
    action === "approve"
      ? {
          review_status: "approved",
          canonical_insurer_key: canonicalKey,
          canonical_insurer_name: canonicalName,
          review_notes: notes || null,
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        }
      : {
          review_status: "rejected",
          canonical_insurer_key: null,
          canonical_insurer_name: null,
          review_notes: notes || null,
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        };

  const { data: updated, error: updateError } = await service
    .from("collision_insurer_alias_reviews")
    .update(patch)
    .eq("source_label_normalized", sourceLabel)
    .eq("review_status", "candidate")
    .select("source_label_normalized")
    .maybeSingle();
  if (updateError) {
    console.error("[insurer-alias-review] update failed:", updateError.message);
    return redirectToQueue(request, "error");
  }
  if (!updated) {
    return redirectToQueue(request, "conflict");
  }

  return redirectToQueue(
    request,
    action === "approve" ? "approved" : "rejected",
  );
}
