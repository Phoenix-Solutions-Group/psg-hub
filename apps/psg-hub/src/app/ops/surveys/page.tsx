import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { NewSurveyForm } from "@/components/ops/new-survey-form";
import { formatEmi } from "@/lib/ops/surveys";

// Ops Surveys vertical (v1.1 / PSG-36): manual CSI survey entry + view over the
// existing survey_responses table. Gated by manage_reports — surveys are the raw
// input to the /ops/reports CSI surface.

type SurveyRow = {
  id: number;
  shop_name: string;
  survey_date: string;
  scale_emi_pct: number | null;
  source: string | null;
};

export default async function SurveysPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_reports")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Surveys</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_reports</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data } = await service
    .from("survey_responses")
    .select("id, shop_name, survey_date, scale_emi_pct, source")
    .order("survey_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  const surveys = (data ?? []) as SurveyRow[];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Surveys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {surveys.length} most recent CSI responses
          </p>
        </div>
      </div>

      <NewSurveyForm />

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">Survey date</th>
              <th className="px-4 py-3">EMI</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {surveys.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No surveys yet. Record the first one above.
                </td>
              </tr>
            ) : (
              surveys.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <a href={`/ops/surveys/${s.id}`} className="font-medium hover:text-ember">
                      {s.shop_name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.survey_date}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatEmi(s.scale_emi_pct)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.source ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
