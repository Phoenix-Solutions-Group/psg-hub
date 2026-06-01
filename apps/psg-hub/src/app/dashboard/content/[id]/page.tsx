import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ContentPreview } from "@/components/dashboard/content-preview";
import { ApprovalActions } from "@/components/dashboard/approval-actions";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  published: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
};

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("content_items")
    .select("*")
    .eq("id", id)
    .single();

  if (!item) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{item.title}</h1>
          <div className="mt-2 flex items-center gap-3">
            <Badge
              variant="secondary"
              className={statusColors[item.status] || ""}
            >
              {item.status.replace(/_/g, " ")}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {item.content_type.replace(/_/g, " ")}
            </span>
            <span className="text-sm text-muted-foreground">
              Updated{" "}
              {new Date(item.updated_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        {item.status === "pending_review" && (
          <ApprovalActions contentId={item.id} />
        )}
      </div>

      <ContentPreview body={item.body} />
    </div>
  );
}
