import { createClient } from "@/lib/supabase/server";
import { AgentStatusCard } from "@/components/dashboard/agent-status-card";

const AGENT_TYPES = [
  "site-designer",
  "web-scraper",
  "seo-auditor",
  "market-researcher",
  "content-writer",
];

export default async function AgentsPage() {
  const supabase = await createClient();

  const { data: runs } = await supabase
    .from("agent_runs")
    .select("agent_type, status, completed_at")
    .order("completed_at", { ascending: false });

  const runsByAgent = AGENT_TYPES.reduce(
    (acc, type) => {
      acc[type] = (runs || []).filter((r) => r.agent_type === type);
      return acc;
    },
    {} as Record<string, typeof runs>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="text-muted-foreground">
          Monitor your marketing agents and their activity.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {AGENT_TYPES.map((type) => (
          <AgentStatusCard
            key={type}
            agentType={type}
            runs={runsByAgent[type] || []}
          />
        ))}
      </div>
    </div>
  );
}
