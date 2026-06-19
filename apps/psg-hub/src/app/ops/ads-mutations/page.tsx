import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { MUTATION_REGISTRY } from "@/lib/ads-mutations/registry";
import { buildAllPreviews } from "@/lib/ads-mutations/preview";
import { isSandboxEnabled } from "@/lib/ads-mutations/bridge";
import { AdsMutationStudio } from "@/components/ops/ads-mutation-studio";

// v1.2 / PSG-26a + PSG-26d — Ads Mutation Studio.
// Gated on the `ads_mutations` capability (psg_superadmin passes implicitly). Builds the
// expected before/after diffs server-side from fixtures (pure, no Vercel Sandbox) for the
// reference preview, and hands the plain data to the client Studio. The Studio also calls
// the live `/api/ads-mutations/{dry-run,execute}` routes — those fail closed with a clean
// 503 `gated` state until the operator enables the Vercel Sandbox (PSG-26 board gate).
export default async function AdsMutationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "ads_mutations")) {
    notFound();
  }

  const previews = buildAllPreviews(MUTATION_REGISTRY.map((m) => m.key));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Ads Mutation Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse the Google Ads + GTM write-side mutations and preview a before/after diff before
          anything runs. The expected diff is computed locally from fixtures; live dry-run / execute
          call the Python worker via the Vercel Sandbox, which is board-gated until the operator
          enables it.
        </p>
      </div>
      <AdsMutationStudio previews={previews} sandboxEnabled={isSandboxEnabled()} />
    </div>
  );
}
