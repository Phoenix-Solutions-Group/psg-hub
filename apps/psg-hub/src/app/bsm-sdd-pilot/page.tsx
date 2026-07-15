import { notFound } from "next/navigation";
import { buildFirstLoginValueState } from "@/lib/bsm/first-login-value";
import { buildShopAuditReport } from "@/lib/seo-audit/report";
import type { ShopBrief } from "@/lib/seo-audit/types";
import { ApprovalCard, type ApprovalCardRow } from "@/components/dashboard/approval-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const INSPECTION_ENABLED = process.env.BSM_SDD_PILOT_PREVIEW === "1";

const PILOT_BRIEF: ShopBrief = {
  shopId: "bsm-sdd-pilot-shop",
  businessName: "Tracy's Collision Center",
  domain: null,
  vertical: "collision_repair",
  services: ["collision repair", "frame straightening", "paintless dent repair"],
  locations: [{ city: "Lincoln", state: "NE", primary: true }],
  competitors: [],
};

const GENERATED_AT = "2026-07-14T22:45:00.000Z";

const googlePostApproval: ApprovalCardRow = {
  id: "bsm-sdd-pilot-google-post",
  actionType: "gbp_post",
  title: "We can help customers find your shop online",
  summary:
    "BSM found that Tracy's Collision Center does not have a live website to score yet. This Google Business Profile post is a proposed public update only. It will not publish until the owner previews it and confirms.",
  payload: {
    summary:
      "Tracy's Collision Center is reviewing its online presence with Phoenix Solutions Group. Customers can call the shop directly while the new website plan is prepared.",
    callToAction: {
      actionType: "CALL",
      url: "tel:+14024414800",
    },
  },
  status: "pending",
  proposedBy: "BSM assistant",
  createdAt: GENERATED_AT,
  publishError: null,
};

export default function BsmSddPilotPage() {
  if (!INSPECTION_ENABLED) notFound();

  const report = buildShopAuditReport(PILOT_BRIEF, {
    generatedAt: GENERATED_AT,
  });
  const firstLoginValue = buildFirstLoginValueState(report);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Body Shop Marketer pilot inspection
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          First real finding and Google approval path
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          This local-only surface uses the product's actual audit report builder,
          first-login finding copy, and approval guardrail. The shop has no
          website URL in the audit brief, so the finding is the real product
          output for that condition: no live website was found to score.
        </p>
      </header>

      <Card>
        <CardHeader>
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
            {firstLoginValue.eyebrow}
          </p>
          <CardTitle>{firstLoginValue.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {firstLoginValue.detail}
            </p>
            <p className="text-xs text-muted-foreground">
              Audit mode: {report.mode}. Website domain: none supplied by the
              shop. Report date: {report.generatedAt.slice(0, 10)}.
            </p>
          </div>
          <a className={buttonVariants()} href="#google-connect">
            Connect Google
          </a>
        </CardContent>
      </Card>

      <Card id="google-connect">
        <CardHeader>
          <CardTitle>Connect Google Business Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-6 text-muted-foreground">
            The owner starts by connecting Google. BSM can then prepare a public
            Google Business Profile post from the finding, but it still lands in
            review first.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button>Connect Google Business Profile</Button>
            <Button variant="outline" disabled>
              Connected for preview
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            For this inspection page, the connection is shown as already complete
            so Percy and Tess can inspect the approval steps without touching a
            live Google account.
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="approval-heading" className="space-y-3">
        <div>
          <h2 id="approval-heading" className="font-heading text-lg font-semibold">
            Preview before anything publishes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Click "Preview post", then "Continue to confirmation". The publish
            button only appears after both steps.
          </p>
        </div>
        <ApprovalCard row={googlePostApproval} />
      </section>
    </main>
  );
}
