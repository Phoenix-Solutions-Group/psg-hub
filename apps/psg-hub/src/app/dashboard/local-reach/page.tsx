import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getLocalReachWorkspace,
  statusLabel,
  statusTone,
  type LocalReachRecommendation,
} from "@/lib/bsm/local-reach";

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SettingsList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      {values.length === 0 ? (
        <p className="text-sm text-muted-foreground">Pending PSG setup audit.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge key={value} variant="secondary">{value}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({ recommendation }: { recommendation: LocalReachRecommendation }) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {recommendation.type} · {recommendation.market}
            </p>
            <CardTitle className="text-lg">{recommendation.title}</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusTone(recommendation.status)}>
              {statusLabel(recommendation.status)}
            </Badge>
            <Badge variant={recommendation.risk === "high" ? "destructive" : "secondary"}>
              {recommendation.risk} risk
            </Badge>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{recommendation.valueLine}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-heading text-sm font-semibold">Why this matters</h3>
            <p className="text-sm leading-6 text-foreground/90">
              {recommendation.whyItMatters || recommendation.summary}
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-heading text-sm font-semibold">Expected business value</h3>
            <p className="text-sm leading-6 text-foreground/90">
              {recommendation.businessValue || "Helps the shop owner see the value without promising search ranking changes."}
            </p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-4">
          <h3 className="font-heading text-sm font-semibold">What would change</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Target: {recommendation.targetPage ?? "Target page pending PSG setup."}
          </p>
          {recommendation.draftPreview && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{recommendation.draftPreview}</p>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-3">
            <h3 className="font-heading text-sm font-semibold">Evidence</h3>
            {recommendation.evidence.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                Evidence links have not been attached yet. No recommendation should be sent for approval until PSG adds source links and dates.
              </p>
            ) : (
              <div className="space-y-2">
                {recommendation.evidence.map((evidence) => (
                  <a
                    key={evidence.id}
                    href={evidence.url}
                    className="block rounded-md border border-border p-3 hover:border-ember"
                  >
                    <span className="text-sm font-medium">{evidence.sourceName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      observed {formatDate(evidence.sourceDate)}
                    </span>
                    <p className="mt-1 text-sm text-muted-foreground">{evidence.summary}</p>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-md border border-border p-4">
            <h3 className="font-heading text-sm font-semibold">Safety checks</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Customer approval required before publishing.</li>
              <li>{recommendation.locationSafetyNote}</li>
              <li>Manual WordPress/Elementor publishing only.</li>
              <li>No automatic live website edit exists in this MVP.</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {recommendation.approvalItemId ? (
            <Link
              className={buttonVariants()}
              href={`/dashboard/approvals/content/${recommendation.approvalItemId}`}
            >
              Review decision
            </Link>
          ) : (
            <Button disabled>Approval item pending</Button>
          )}
          <p className="text-sm text-muted-foreground">
            Approval means PSG may publish manually. It does not mean the website is already changed.
          </p>
        </div>

        {recommendation.status === "published" && (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
            <p className="font-medium">Published evidence</p>
            <p className="mt-1 text-muted-foreground">
              Live URL: {recommendation.publishedUrl ?? "Not recorded"}
            </p>
            <p className="text-muted-foreground">Published: {formatDate(recommendation.publishedAt)}</p>
            {recommendation.verificationNote && (
              <p className="mt-2 text-foreground/90">{recommendation.verificationNote}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function LocalReachPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let workspace = null;
  let loadError: string | null = null;

  if (user) {
    const { activeShopId } = await getActiveShopContext(user.id);
    if (activeShopId) {
      try {
        workspace = await getLocalReachWorkspace(supabase, activeShopId);
      } catch (error) {
        loadError = error instanceof Error ? error.message : "Local Reach could not load.";
      }
    }
  }

  if (!workspace) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Local Reach</h1>
          <p className="text-muted-foreground">
            We could not load Local Reach right now. Your website is not being changed.
          </p>
        </div>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              {loadError ?? "Choose an active shop before using Local Reach."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { settings, recommendations, stats, setupSteps } = workspace;
  const needsReview = recommendations.filter((item) => item.status === "ready_for_review");
  const publishingQueue = recommendations.filter((item) => item.status === "approved" || item.status === "publishing");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
            Local Reach pilot
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{settings.shopName}</h1>
          <p className="text-muted-foreground">
            {settings.market} · {settings.pilotStatus}
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          <p>Last audit: {formatDate(settings.lastAuditAt)}</p>
          <p>Sources checked through: {formatDate(settings.sourcesCheckedThrough)}</p>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Waiting for review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.waitingForReview}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Approved, not live</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.approvedWaitingForPublishing}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Published in 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.publishedLast30Days}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Needs clarification</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.needsClarification}</p>
          </CardContent>
        </Card>
      </section>

      {recommendations.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Setup audit is not finished yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              PSG is completing the first market and brand audit before recommendations appear. No website changes can happen from this screen.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {setupSteps.map((step) => (
                <div key={step.label} className="rounded-md border border-border p-3">
                  <Badge variant={step.status === "complete" ? "success" : "secondary"}>
                    {step.status}
                  </Badge>
                  <p className="mt-2 text-sm font-medium">{step.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Recommendations</h2>
            <p className="text-sm text-muted-foreground">
              Review the reason, evidence, safety checks, and approval path for each recommended change.
            </p>
          </div>
          {recommendations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">No Local Reach recommendations are ready yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {(needsReview.length > 0 ? needsReview : recommendations).map((recommendation) => (
                <RecommendationCard key={recommendation.id} recommendation={recommendation} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <SettingsList label="Service area" values={settings.serviceArea} />
              <SettingsList label="Services" values={settings.services} />
              <SettingsList label="Certifications" values={settings.certifications} />
              <SettingsList label="Claims to avoid" values={settings.claimsToAvoid} />
              <SettingsList label="Approval contacts" values={settings.approvalContacts} />
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase text-muted-foreground">Publishing notes</p>
                <p className="text-sm leading-6 text-muted-foreground">{settings.publishingNotes}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {publishingQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground">No approved recommendations are waiting for PSG publishing.</p>
              ) : (
                publishingQueue.map((item) => (
                  <div key={item.id} className="rounded-md border border-border p-3">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      PSG owns the manual WordPress/Elementor publishing step.
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">30-day value</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>{stats.createdLast30Days} recommendations created.</p>
              <p>{stats.waitingForReview} open customer decisions.</p>
              <p>{stats.publishedLast30Days} published actions verified.</p>
              <p>These are activity and progress indicators, not guaranteed ranking results.</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
