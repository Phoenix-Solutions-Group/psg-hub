import { createClient } from "@/lib/supabase/server";
import { ContentTable } from "@/components/dashboard/content-table";

export default async function ContentPage() {
  const supabase = await createClient();

  const { data: items } = await supabase
    .from("content_items")
    .select("id, title, content_type, status, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Content</h1>
        <p className="text-muted-foreground">
          Review and approve agent-produced content.
        </p>
      </div>
      <ContentTable items={items || []} />
    </div>
  );
}
