import { Badge } from "@/components/ui/badge";

export type ApprovedContentArchiveRow = {
  id: string;
  title: string;
  contentType: string;
  sourceKind: string;
  versionNumber: number;
  versionLabel: string | null;
  decision: string;
  approver: string | null;
  approvedAt: string;
  previewHref: string | null;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ApprovedContentArchiveTable({
  rows,
}: {
  rows: ApprovedContentArchiveRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No approved content has been archived yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left font-heading text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Content</th>
            <th className="px-4 py-3">Version</th>
            <th className="px-4 py-3">Decision</th>
            <th className="px-4 py-3">Approver</th>
            <th className="px-4 py-3">Approved</th>
            <th className="px-4 py-3">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="px-4 py-3">
                <div className="font-medium">{row.title}</div>
                <div className="text-xs text-muted-foreground">{formatLabel(row.contentType)}</div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.versionLabel ?? `Version ${row.versionNumber}`}
              </td>
              <td className="px-4 py-3">
                <Badge variant="success">{formatLabel(row.decision)}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.approver ?? "Recorded customer"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(row.approvedAt)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.previewHref ? (
                  <a href={row.previewHref} className="font-medium text-foreground hover:text-ember">
                    {formatLabel(row.sourceKind)}
                  </a>
                ) : (
                  formatLabel(row.sourceKind)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
