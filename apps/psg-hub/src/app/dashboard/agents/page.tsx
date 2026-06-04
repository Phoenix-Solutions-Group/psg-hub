import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AgentsPage() {
  // Agent activity is deferred to a later milestone (v1.6); the backing table is not
  // yet provisioned. Guard the surface so it renders a clear "coming soon" state
  // instead of querying a phantom table.
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="text-muted-foreground">
          Monitor your marketing agents and their activity.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Agent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Agent activity arrives in a later milestone. This is where you will
            track your marketing agents and their runs once they are enabled.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
