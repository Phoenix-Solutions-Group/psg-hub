import { type NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { MUTATION_REGISTRY, mutationsForPlatform } from "@/lib/ads-mutations/registry";
import { isSandboxEnabled } from "@/lib/ads-mutations/bridge";

// GET /api/ads-mutations/registry[?platform=google_ads|gtm]
//
// Read-only catalog of UI-selectable mutations for the Ads Mutation Studio.
// Gate-INDEPENDENT: no Vercel Sandbox is required to browse the registry, so the Studio
// can render its picker before the live bridge lands. `sandboxEnabled` lets the UI disable
// dry-run/execute affordances until the gate clears.
//
// INTERIM GATE: superadmin-only. The Studio's intended capability is the fine-grained
// `ads_mutations` (current_user_has_fn('ads_mutations'), per the migration); swap this to
// requireOpsFn("ads_mutations") once PSG-25 adds that key to the ops capability vocabulary.
export async function GET(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const platform = request.nextUrl.searchParams.get("platform");
  if (platform && platform !== "google_ads" && platform !== "gtm") {
    return NextResponse.json({ error: "Invalid platform" }, { status: 422 });
  }

  const mutations =
    platform === "google_ads" || platform === "gtm"
      ? mutationsForPlatform(platform)
      : MUTATION_REGISTRY;

  return NextResponse.json({
    sandboxEnabled: isSandboxEnabled(),
    count: mutations.length,
    mutations,
  });
}
