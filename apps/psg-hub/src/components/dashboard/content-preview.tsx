import { renderMarkdown } from "@/lib/markdown/render";

export function ContentPreview({ body }: { body: string | null }) {
  if (!body) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        No content body available.
      </div>
    );
  }

  // PSG-768 — render faithfully via the shared sanitized-Markdown renderer so the
  // preview matches what publishes (real bold/italic/links/lists, never raw
  // `**text**`). Safe by construction: no dangerouslySetInnerHTML, URLs allow-listed.
  return (
    <article className="max-w-none space-y-4 rounded-lg border bg-card p-6">
      {renderMarkdown(body, "article")}
    </article>
  );
}
