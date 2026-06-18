import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { formatEmi } from "@/lib/ops/surveys";

// Single-survey view (v1.1 / PSG-36). Read-only detail of one CSI response;
// q05_01..04 map to quality / cleanliness / communication / courtesy.

type SurveyDetail = {
  id: number;
  shop_name: string;
  survey_date: string;
  scale_emi_pct: number | null;
  q05_01: number | null;
  q05_02: number | null;
  q05_03: number | null;
  q05_04: number | null;
  text_customer_comments: string | null;
  source: string | null;
  response_id: string | null;
  created_at: string | null;
};

const score = (n: number | null) => (n == null ? "—" : n.toFixed(1));

export default async function SurveyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_reports")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Survey</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_reports</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data } = await service
    .from("survey_responses")
    .select(
      "id, shop_name, survey_date, scale_emi_pct, q05_01, q05_02, q05_03, q05_04, text_customer_comments, source, response_id, created_at"
    )
    .eq("id", numericId)
    .maybeSingle();

  if (!data) notFound();
  const s = data as SurveyDetail;

  const metrics = [
    { label: "EMI", value: formatEmi(s.scale_emi_pct) },
    { label: "Quality", value: score(s.q05_01) },
    { label: "Cleanliness", value: score(s.q05_02) },
    { label: "Communication", value: score(s.q05_03) },
    { label: "Courtesy", value: score(s.q05_04) },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/ops/surveys" className="text-sm text-muted-foreground hover:text-ember">
          ← Surveys
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">{s.shop_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Surveyed {s.survey_date}
          {s.source ? ` · ${s.source}` : ""}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-border p-4">
            <p className="font-heading text-xs uppercase tracking-wide text-muted-foreground">
              {m.label}
            </p>
            <p className="mt-1 text-xl font-semibold">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border p-4">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Customer comments
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {s.text_customer_comments?.trim() || "No comments recorded."}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between border-b border-border py-2">
          <dt className="text-muted-foreground">Survey ID</dt>
          <dd className="font-mono">{s.id}</dd>
        </div>
        <div className="flex justify-between border-b border-border py-2">
          <dt className="text-muted-foreground">Response ID</dt>
          <dd className="font-mono">{s.response_id ?? "—"}</dd>
        </div>
        <div className="flex justify-between border-b border-border py-2">
          <dt className="text-muted-foreground">Recorded</dt>
          <dd>{s.created_at ? new Date(s.created_at).toLocaleString() : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
