import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AgentRun = {
  agent_type: string;
  status: string;
  completed_at: string | null;
};

const agentLabels: Record<string, string> = {
  "site-designer": "Site Designer",
  "web-scraper": "Web Scraper",
  "seo-auditor": "SEO Auditor",
  "market-researcher": "Market Researcher",
  "content-writer": "Content Writer",
};

const statusColors: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  running: "bg-blue-100 text-blue-800",
  pending: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
};

export function AgentStatusCard({
  agentType,
  runs,
}: {
  agentType: string;
  runs: AgentRun[];
}) {
  const lastRun = runs[0];
  const label = agentLabels[agentType] || agentType;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {lastRun ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={statusColors[lastRun.status] || ""}
              >
                {lastRun.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {runs.length} total runs
              </span>
            </div>
            {lastRun.completed_at && (
              <p className="text-xs text-muted-foreground">
                Last run:{" "}
                {new Date(lastRun.completed_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No runs yet</p>
        )}
      </CardContent>
    </Card>
  );
}
