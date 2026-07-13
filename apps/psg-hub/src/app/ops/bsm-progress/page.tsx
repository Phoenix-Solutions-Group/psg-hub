import {
  Activity,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  GitBranch,
  ListChecks,
  RefreshCw,
  Route,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getBsmProgressSnapshot, type BsmProgressIssue } from "@/lib/bsm-progress";
import { BsmIdeaForm } from "./idea-form";

export const dynamic = "force-dynamic";

const ROADMAP = [
  {
    label: "Foundation",
    status: "Complete",
    note: "Core Next.js app, PSG brand, account gates, and customer dashboard shell are in place.",
  },
  {
    label: "Customer MVP",
    status: "In progress",
    note: "Shop access, onboarding, content review, billing, and analytics surfaces are being hardened.",
  },
  {
    label: "Analytics",
    status: "In progress",
    note: "Google Ads, Google Analytics, Search Console, reviews, and local visibility roll into one story-led view.",
  },
  {
    label: "Operations",
    status: "Building next",
    note: "Internal PSG workflows, imports, production, reports, and customer support tools expand after customer MVP.",
  },
  {
    label: "Agentic intelligence",
    status: "Queued",
    note: "Market intelligence, competitor tracking, and multi-tool research agents arrive after core launch readiness.",
  },
];

const TOOL_ACTIONS = [
  {
    tool: "Paperclip",
    action: "Tracks the live build tasks, blockers, approvals, owners, and board-ready status updates.",
  },
  {
    tool: "Graphify",
    action: "Maps the codebase so engineers can find the right files before changing the product.",
  },
  {
    tool: "Supabase",
    action: "Stores account, shop, billing, operations, and analytics data with customer-safe access rules.",
  },
  {
    tool: "Vercel",
    action: "Publishes the PSG Hub web app and confirms production builds after approved milestones.",
  },
  {
    tool: "QA",
    action: "Verifies customer-facing behavior before work is marked ready to ship.",
  },
];

const COST_LINES = [
  { label: "Current build model", value: "Agent engineering time tracked in Paperclip" },
  { label: "Primary hosting", value: "Vercel for the web app" },
  { label: "Primary data platform", value: "Supabase for database, auth, and storage" },
  { label: "Cost watchpoint", value: "External APIs added only when a feature needs them" },
];

export default async function BsmProgressPage() {
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
                <div key={item.label} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[150px_120px_1fr]">
                  <div className="font-heading text-sm font-semibold">{item.label}</div>
                  <Badge variant={item.status === "Complete" ? "default" : "outline"}>{item.status}</Badge>
                  <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
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
                <div key={item.tool}>
                  <div className="font-heading text-sm font-semibold">{item.tool}</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.action}</p>
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
