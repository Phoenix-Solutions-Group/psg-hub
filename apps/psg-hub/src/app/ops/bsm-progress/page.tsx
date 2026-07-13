import {
  Activity,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  GitBranch,
  ListChecks,
  RefreshCw,
  Route,
  Wrench,
} from "lucide-react";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { getBsmProgressSnapshot, type BsmProgressIssue } from "@/lib/bsm-progress";
import { BsmIdeaForm } from "./idea-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROADMAP = [
  {
    label: "Foundation",
    status: "Complete",
    note: "Core Next.js app, PSG brand, account gates, and customer dashboard shell are in place.",
    features: [
      "Unified PSG Hub app shell with protected customer, operations, and superadmin areas.",
      "PSG brand system, navigation, and responsive dashboard layout.",
      "Signed-in access with shop-aware permissions so customers see only their own shop.",
      "Shared build tracking through Paperclip so roadmap work has owners, blockers, and review history.",
    ],
  },
  {
    label: "Customer MVP",
    status: "In progress",
    note: "Shop access, onboarding, content review, billing, and analytics surfaces are being hardened.",
    features: [
      "Shop switcher and tier gates for single-shop owners and multi-shop operators.",
      "Customer onboarding checks for shop profile, website, Google accounts, and baseline marketing data.",
      "Content brief, draft, review, and approval flow for shop-facing marketing work.",
      "Stripe invoice and payment view so shops can see what they owe PSG in one place.",
    ],
  },
  {
    label: "Analytics",
    status: "In progress",
    note: "Google Ads, Google Analytics, Search Console, reviews, and local visibility roll into one story-led view.",
    features: [
      "Google Ads performance summaries with spend, leads, and campaign health.",
      "Google Analytics and Search Console trend cards for website visits, search clicks, and top pages.",
      "Google Business Profile presence and reviews intake for rating, review volume, and sentiment signals.",
      "Monthly report renderer that turns raw marketing data into board- and customer-readable summaries.",
    ],
  },
  {
    label: "Operations",
    status: "Building next",
    note: "Internal PSG workflows, imports, production, reports, and customer support tools expand after customer MVP.",
    features: [
      "Repair order, estimate, repair customer, company, employee, and master-data management.",
      "FileMaker replacement import flow for repair orders and estimates with repeatable validation.",
      "Production module for mail batches, artwork/templates, print status, reprints, and vendor handoff.",
      "Operational reports for PSG staff, including production, survey, billing, and account-service views.",
    ],
  },
  {
    label: "Agentic intelligence",
    status: "Queued",
    note: "Market intelligence, competitor tracking, and multi-tool research agents arrive after core launch readiness.",
    features: [
      "Competitor monitoring and local market scoring for each shop's service area.",
      "Automated research agents that gather evidence before drafting recommendations.",
      "AI-assisted content and report generation with claim checks before anything customer-facing ships.",
      "Audit trail for agent actions, tool usage, approvals, and follow-up tasks.",
    ],
  },
];

const TOOL_ACTIONS = [
  {
    tool: "Paperclip",
    action: "Tracks the live build tasks, blockers, approvals, owners, and board-ready status updates.",
    href: "/PSG/issues?projectId=a9ae4312-c9b0-4481-a2aa-bbea9c3dbd6c&q=BSM",
    destination: "Live BSM task board inside Paperclip. Login required.",
  },
  {
    tool: "Graphify",
    action: "Maps the codebase so engineers can find the right files before changing the product.",
    href: "https://github.com/Phoenix-Solutions-Group/psg-hub/actions/workflows/graphify-refresh.yml",
    destination: "Codebase graph refresh runs and downloadable Graphify report artifacts. GitHub login may be required.",
  },
  {
    tool: "Supabase",
    action: "Stores account, shop, billing, operations, and analytics data with customer-safe access rules.",
    href: "https://supabase.com/dashboard/project/gylkkzmcmbdftxieyabw",
    destination: "Real PSG Hub Supabase project dashboard. Admin login required; no secrets are shown here.",
  },
  {
    tool: "Vercel",
    action: "Publishes the PSG Hub web app and confirms production builds after approved milestones.",
    href: "https://vercel.com/psg-digital/psg-hub",
    destination: "Real PSG Hub Vercel project view. Team login required.",
  },
  {
    tool: "QA",
    action: "Verifies customer-facing behavior before work is marked ready to ship.",
    href: "https://github.com/Phoenix-Solutions-Group/psg-hub/tree/main/apps/psg-hub/src/lib",
    destination: "Current repository test and verification source area. GitHub login may be required.",
  },
];

const COST_LINES = [
  { label: "Current build model", value: "Agent engineering time tracked in Paperclip" },
  { label: "Primary hosting", value: "Vercel for the web app" },
  { label: "Primary data platform", value: "Supabase for database, auth, and storage" },
  { label: "Cost watchpoint", value: "External APIs added only when a feature needs them" },
];

export default async function BsmProgressPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">BSM build progress</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const snapshot = await getBsmProgressSnapshot();
  const counts = countByStatus(snapshot.issues);
  const updatedToday = snapshot.issues.filter((issue) => isToday(issue.updatedAt)).length;
  const latestIssues = snapshot.issues.slice(0, 8);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col justify-between gap-4 border-b border-border pb-6 lg:flex-row lg:items-end">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <Badge variant={snapshot.configured ? "default" : "outline"}>
              {snapshot.configured ? "Live monitor" : "Setup needed"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Updated {formatDateTime(snapshot.fetchedAt)}
            </span>
          </div>
          <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
            BSM build progress
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            One internal place to see what is moving, what is waiting, what tools are involved,
            and where to add ideas before they become build tasks.
          </p>
        </div>
        <a
          href="/ops/bsm-progress"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-primary px-3 font-heading text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh status
        </a>
      </section>

      {snapshot.error && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          {snapshot.error} The dashboard remains usable as the BSM roadmap and intake hub; live
          counts will appear when Paperclip read access is configured for the web app.
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Active work" value={counts.active} hint="Tasks being built or reviewed" />
        <MetricCard icon={ListChecks} label="Done" value={counts.done} hint="Completed BSM tasks in the live feed" />
        <MetricCard icon={CalendarClock} label="Updated today" value={updatedToday} hint="Tasks changed in the last UTC day" />
        <MetricCard icon={Clock3} label="Hourly view" value="Now" hint="Refresh this page for current Paperclip status" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="space-y-6">
          <Panel title="Live workstream" icon={GitBranch}>
            {latestIssues.length === 0 ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Live Paperclip tasks are not available in this runtime yet. Once configured,
                the most recently changed BSM tasks will appear here automatically.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {latestIssues.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Roadmap" icon={Route}>
            <div className="space-y-4">
              {ROADMAP.map((item) => (
                <div key={item.label} className="rounded-lg border border-border p-4">
                  <div className="grid gap-3 sm:grid-cols-[150px_120px_1fr]">
                    <div className="font-heading text-sm font-semibold">{item.label}</div>
                    <Badge variant={item.status === "Complete" ? "default" : "outline"}>{item.status}</Badge>
                    <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
                  </div>
                  <ul className="mt-4 grid gap-2 border-t border-border pt-4 text-sm leading-6 text-muted-foreground md:grid-cols-2">
                    {item.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ember" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Time and cost" icon={CircleDollarSign}>
            <div className="space-y-3">
              {COST_LINES.map((line) => (
                <div key={line.label} className="rounded-lg border border-border p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {line.label}
                  </div>
                  <div className="mt-1 text-sm">{line.value}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Tools and actions" icon={Wrench}>
            <div className="space-y-3">
              {TOOL_ACTIONS.map((item) => (
                <div key={item.tool} className="rounded-lg border border-border p-3">
                  <a
                    href={item.href}
                    target={item.href.startsWith("http") ? "_blank" : undefined}
                    rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                    className="inline-flex items-center gap-2 font-heading text-sm font-semibold text-primary hover:text-ember"
                  >
                    {item.tool}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.action}</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.destination}</p>
                </div>
              ))}
            </div>
          </Panel>

          <BsmIdeaForm />
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <Icon className="size-4 text-ember" aria-hidden="true" />
      </div>
      <div className="mt-3 font-heading text-2xl font-semibold">{value}</div>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="size-4 text-ember" aria-hidden="true" />
        <h2 className="font-heading text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function IssueRow({ issue }: { issue: BsmProgressIssue }) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[110px_1fr_140px]">
      <div>
        <a
          href={`/PSG/issues/${issue.identifier}`}
          className="font-heading text-sm font-semibold text-primary hover:text-ember"
        >
          {issue.identifier}
        </a>
        <div className="mt-1">
          <Badge variant={issue.status === "done" ? "default" : "outline"}>{statusLabel(issue.status)}</Badge>
        </div>
      </div>
      <div>
        <div className="font-heading text-sm font-semibold">{issue.title}</div>
        <p className="mt-1 text-sm text-muted-foreground">Owner: {issue.assignee}</p>
      </div>
      <div className="text-sm text-muted-foreground">{formatDateTime(issue.updatedAt)}</div>
    </div>
  );
}

function countByStatus(issues: BsmProgressIssue[]) {
  return issues.reduce(
    (acc, issue) => {
      if (issue.status === "done") acc.done += 1;
      if (["todo", "in_progress", "in_review", "blocked"].includes(issue.status)) acc.active += 1;
      return acc;
    },
    { active: 0, done: 0 },
  );
}

function isToday(value: string | null) {
  if (!value) return false;
  const today = new Date().toISOString().slice(0, 10);
  return value.slice(0, 10) === today;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function formatDateTime(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
