import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import previewEvidence from "@/lib/collision-intelligence/body-shop-insurance-appetite.json";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type AppetiteEvidence = (typeof previewEvidence)[number];

const coverageLabels: Record<string, string> = {
  businessowners_policy: "Businessowners policy",
  commercial_auto: "Commercial auto",
  garagekeepers: "Garagekeepers",
  general_liability: "General liability",
  workers_compensation: "Workers' compensation",
};

export default async function BodyShopInsuranceMarketPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getDashboardAccess(user.id);
  if (access.role !== "psg_superadmin") redirect("/dashboard");

  const result = await createServiceClient()
    .from("collision_shop_insurance_appetite_evidence")
    .select(
      "registry_source,registry_type,registry_id,naics_code,carrier_name,evidence_type,evidence_scope,state_codes,coverage_types,source_name,source_url,evidence_summary,observed_on,valid_through,is_current",
    )
    .eq("naics_code", "811121")
    .eq("is_current", true)
    .order("carrier_name");

  const releasePending = result.error?.code === "PGRST205";
  if (result.error && !releasePending) throw result.error;
  const evidence = (
    releasePending ? previewEvidence : (result.data ?? [])
  ) as AppetiteEvidence[];
  const appetiteEvidence = evidence.filter(
    (row) => row.evidence_type === "carrier_appetite",
  );
  const stateVerified = evidence.filter(
    (row) => row.evidence_type === "state_authorization",
  ).length;
  const policyObserved = evidence.filter(
    (row) => row.evidence_type === "policy_observation",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Collision intelligence
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Body Shop Insurance Market
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Evidence-backed insurers that explicitly target automotive body,
            paint, and collision shops in NAICS 811121. This is separate from
            the carriers paying consumer repair claims.
          </p>
        </div>
        <Link
          href="/dashboard/collision-intelligence"
          className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium transition-colors hover:bg-secondary"
        >
          Repair intelligence
        </Link>
      </div>

      {releasePending ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="pt-6">
            <p className="font-heading font-semibold">Preview evidence</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The reviewed source set is shown from the release artifact. The
              service-only database migration and import are not yet applied.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="NAICS"
          value="811121"
          detail="Body, paint, and collision repair"
        />
        <MetricCard
          label="Industry appetite"
          value={appetiteEvidence.length.toLocaleString()}
          detail="Explicit carrier-source matches"
        />
        <MetricCard
          label="State authorization"
          value={stateVerified.toLocaleString()}
          detail="Legal entities verified by state"
        />
        <MetricCard
          label="PSG policy evidence"
          value={policyObserved.toLocaleString()}
          detail="Active customer policies observed"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How a carrier earns a place here</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <EvidenceStep
            number="1"
            title="Industry appetite"
            description="The carrier's own material explicitly names body, paint, or collision shops."
          />
          <EvidenceStep
            number="2"
            title="State and entity"
            description="The legal underwriting company and relevant authority are verified for the shop's state."
          />
          <EvidenceStep
            number="3"
            title="Policy evidence"
            description="A current PSG customer declaration or broker confirmation proves real placement."
          />
        </CardContent>
      </Card>

      <section aria-labelledby="market-carriers-heading" className="space-y-3">
        <div>
          <h2 id="market-carriers-heading" className="text-lg font-semibold">
            Exact-industry carrier evidence
          </h2>
          <p className="text-sm text-muted-foreground">
            Broader auto-repair marketing is excluded unless the source names
            body or collision operations. Availability and underwriting still
            vary by state, legal entity, and individual risk.
          </p>
        </div>

        {appetiteEvidence.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-muted-foreground">
              No current NAICS 811121 appetite evidence has been imported.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {appetiteEvidence.map((row) => (
              <Card key={`${row.registry_id}:${row.source_url}`}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle>{row.carrier_name}</CardTitle>
                    <Badge variant="success">Industry fit confirmed</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    NAIC group {row.registry_id}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {row.evidence_summary}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {row.coverage_types.map((coverage) => (
                      <Badge key={coverage} variant="outline">
                        {coverageLabels[coverage] ??
                          coverage.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                  <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                    <p className="font-heading font-semibold">
                      State authorization pending
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Confirm the writing company and product authority before
                      treating this carrier as available to a specific shop.
                    </p>
                  </div>
                  <a
                    href={row.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex font-heading text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {row.source_name} ↗
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function EvidenceStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-xs font-bold text-primary-foreground">
        {number}
      </span>
      <div>
        <p className="font-heading font-semibold">{title}</p>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
