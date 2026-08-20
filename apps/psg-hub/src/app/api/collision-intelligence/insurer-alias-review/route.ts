import { NextResponse } from "next/server";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const destination = "/dashboard/collision-intelligence/review";
const canonicalKeyPattern = /^[a-z0-9]+(?: [a-z0-9]+)*$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const registryTargetPattern =
  /^registry:([a-z0-9_]+):(group|company):([0-9]+)$/;

function canonicalKey(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
  const expectedStatus = text(formData, "expected_status") || "candidate";
  const canonicalTarget = text(formData, "canonical_target");
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
  if (!["candidate", "approved", "rejected"].includes(expectedStatus)) {
    return NextResponse.json(
      { error: "Invalid review status" },
      { status: 400 },
    );
  }
  if (notes.length > 1000) {
    return NextResponse.json({ error: "Notes are too long" }, { status: 400 });
  }
  if (
    action === "approve" &&
    (!canonicalTarget || canonicalTarget.length > 300)
  ) {
    return NextResponse.json(
      { error: "A verified insurer match is required" },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: evidence, error: evidenceError } = await service
    .from("v_collision_insurer_alias_review_queue")
    .select("source_label_normalized,source_label_name")
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

  let canonicalInsurerKey = "";
  let canonicalInsurerName = "";
  let canonicalRegistrySource: string | null = null;
  let canonicalRegistryType: string | null = null;
  let canonicalRegistryId: string | null = null;
  if (action === "approve") {
    if (canonicalTarget === "source") {
      canonicalInsurerName = evidence.source_label_name.trim();
      canonicalInsurerKey = canonicalKey(canonicalInsurerName);
    } else if (canonicalTarget.startsWith("master:")) {
      const insurerId = canonicalTarget.slice("master:".length);
      if (!uuidPattern.test(insurerId)) {
        return NextResponse.json(
          { error: "Invalid insurer selection" },
          { status: 400 },
        );
      }
      const { data: insurer, error: insurerError } = await service
        .from("insurance_companies")
        .select("name")
        .eq("id", insurerId)
        .maybeSingle();
      if (insurerError) {
        console.error(
          "[insurer-alias-review] master insurer lookup failed:",
          insurerError.message,
        );
        return redirectToQueue(request, "error");
      }
      if (!insurer) return redirectToQueue(request, "target_missing");
      canonicalInsurerName = insurer.name.trim();
      canonicalInsurerKey = canonicalKey(canonicalInsurerName);
    } else if (registryTargetPattern.test(canonicalTarget)) {
      const [, registrySource, registryType, registryId] =
        canonicalTarget.match(registryTargetPattern) ?? [];
      const { data: insurer, error: insurerError } = await service
        .from("collision_insurer_registry")
        .select("source,record_type,registry_id,display_name")
        .eq("source", registrySource)
        .eq("record_type", registryType)
        .eq("registry_id", registryId)
        .eq("is_current", true)
        .maybeSingle();
      if (insurerError) {
        console.error(
          "[insurer-alias-review] registry insurer lookup failed:",
          insurerError.message,
        );
        return redirectToQueue(request, "error");
      }
      if (!insurer) return redirectToQueue(request, "target_missing");
      canonicalInsurerName = insurer.display_name.trim();
      canonicalInsurerKey = canonicalKey(canonicalInsurerName);
      canonicalRegistrySource = insurer.source;
      canonicalRegistryType = insurer.record_type;
      canonicalRegistryId = insurer.registry_id;
    } else if (canonicalTarget.startsWith("approved:")) {
      const insurerKey = canonicalTarget.slice("approved:".length);
      if (!canonicalKeyPattern.test(insurerKey) || insurerKey.length > 200) {
        return NextResponse.json(
          { error: "Invalid insurer selection" },
          { status: 400 },
        );
      }
      const { data: insurer, error: insurerError } = await service
        .from("collision_insurer_alias_reviews")
        .select(
          "canonical_insurer_key,canonical_insurer_name,canonical_registry_source,canonical_registry_type,canonical_registry_id",
        )
        .eq("review_status", "approved")
        .eq("canonical_insurer_key", insurerKey)
        .limit(1)
        .maybeSingle();
      if (insurerError) {
        console.error(
          "[insurer-alias-review] approved insurer lookup failed:",
          insurerError.message,
        );
        return redirectToQueue(request, "error");
      }
      if (!insurer) return redirectToQueue(request, "target_missing");
      canonicalInsurerKey = insurer.canonical_insurer_key?.trim() ?? "";
      canonicalInsurerName = insurer.canonical_insurer_name?.trim() ?? "";
      canonicalRegistrySource = insurer.canonical_registry_source;
      canonicalRegistryType = insurer.canonical_registry_type;
      canonicalRegistryId = insurer.canonical_registry_id;
    } else {
      return NextResponse.json(
        { error: "Invalid insurer selection" },
        { status: 400 },
      );
    }

    if (
      !canonicalKeyPattern.test(canonicalInsurerKey) ||
      canonicalInsurerKey.length > 200 ||
      !canonicalInsurerName ||
      canonicalInsurerName.length > 200
    ) {
      return NextResponse.json(
        { error: "Selected insurer cannot be used as a reporting name" },
        { status: 400 },
      );
    }
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
          canonical_insurer_key: canonicalInsurerKey,
          canonical_insurer_name: canonicalInsurerName,
          canonical_registry_source: canonicalRegistrySource,
          canonical_registry_type: canonicalRegistryType,
          canonical_registry_id: canonicalRegistryId,
          review_notes: notes || null,
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        }
      : {
          review_status: "rejected",
          canonical_insurer_key: null,
          canonical_insurer_name: null,
          canonical_registry_source: null,
          canonical_registry_type: null,
          canonical_registry_id: null,
          review_notes: notes || null,
          reviewed_by: user.id,
          reviewed_at: reviewedAt,
        };

  const { data: updated, error: updateError } = await service
    .from("collision_insurer_alias_reviews")
    .update(patch)
    .eq("source_label_normalized", sourceLabel)
    .eq("review_status", expectedStatus)
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
