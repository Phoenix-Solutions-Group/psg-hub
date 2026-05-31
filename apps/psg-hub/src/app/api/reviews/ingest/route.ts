import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdapter, hasAdapter } from "@/lib/reviews";
import type { ReviewPlatform, ReviewSource } from "@/lib/reviews/types";

type IngestBody = { shop_id?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shop_id = body.shop_id;
  if (!shop_id) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("profile_id", user.id)
    .eq("shop_id", shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();

  const { data: sources, error: srcErr } = await service
    .from("review_sources")
    .select("id, shop_id, platform, external_account_id, credentials, active")
    .eq("shop_id", shop_id)
    .eq("active", true);

  if (srcErr) {
    return NextResponse.json({ error: srcErr.message }, { status: 500 });
  }

  if (!sources || sources.length === 0) {
    return NextResponse.json({
      inserted: 0,
      skipped: 0,
      errors: [],
      message: "No active review sources configured",
    });
  }

  type FetchOutcome =
    | { ok: true; source: ReviewSource; reviews: unknown[] }
    | { ok: false; platform: ReviewPlatform; message: string };

  const results: FetchOutcome[] = await Promise.all(
    sources.map(async (source): Promise<FetchOutcome> => {
      if (!hasAdapter(source.platform as ReviewPlatform)) {
        return {
          ok: false,
          platform: source.platform as ReviewPlatform,
          message: "no adapter",
        };
      }
      try {
        const adapter = getAdapter(source.platform as ReviewPlatform);
        const reviews = await adapter.fetch(source as ReviewSource);
        return { ok: true, source: source as ReviewSource, reviews };
      } catch (err) {
        return {
          ok: false,
          platform: source.platform as ReviewPlatform,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  const rowsToInsert = results.flatMap((r) =>
    r.ok
      ? (r.reviews as Array<Record<string, unknown>>).map((rev) => ({
          shop_id: r.source.shop_id,
          platform: rev.platform,
          external_id: rev.external_id,
          author: rev.author,
          rating: rev.rating,
          body: rev.body,
          posted_at: rev.posted_at,
          url: rev.url,
          raw: rev.raw,
        }))
      : []
  );

  const errors = results
    .filter((r): r is Extract<FetchOutcome, { ok: false }> => !r.ok)
    .map((r) => ({ platform: r.platform, message: r.message }));

  let inserted = 0;
  if (rowsToInsert.length > 0) {
    const { data: upserted, error: insErr } = await service
      .from("reviews")
      .upsert(rowsToInsert, {
        onConflict: "shop_id,platform,external_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (insErr) {
      return NextResponse.json(
        { error: insErr.message, errors },
        { status: 500 }
      );
    }
    inserted = upserted?.length ?? 0;
  }

  const skipped = rowsToInsert.length - inserted;

  return NextResponse.json({ inserted, skipped, errors });
}
