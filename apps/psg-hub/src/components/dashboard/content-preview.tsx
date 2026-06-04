export function ContentPreview({ body }: { body: string | null }) {
  if (!body) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        No content body available.
      </div>
    );
  }

  // Render body as plain text paragraphs (agent content is markdown text)
  // Full HTML rendering with sanitization will be added when DOMPurify is integrated
  const paragraphs = body.split("\n\n").filter(Boolean);

  return (
    <article className="max-w-none rounded-lg border bg-card p-6 space-y-4">
      {paragraphs.map((paragraph, i) => {
        const trimmed = paragraph.trim();
        if (trimmed.startsWith("# ")) {
          return (
            <h1 key={i} className="text-2xl font-bold text-foreground">
              {trimmed.slice(2)}
            </h1>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h2 key={i} className="text-xl font-semibold text-foreground">
              {trimmed.slice(3)}
            </h2>
          );
        }
        if (trimmed.startsWith("### ")) {
          return (
            <h3 key={i} className="text-lg font-semibold text-foreground">
              {trimmed.slice(4)}
            </h3>
          );
        }
        if (trimmed.startsWith("- ")) {
          const items = trimmed.split("\n").filter((l) => l.startsWith("- "));
          return (
            <ul key={i} className="list-disc pl-6 space-y-1 text-foreground">
              {items.map((item, j) => (
                <li key={j}>{item.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-foreground leading-7">
            {trimmed}
          </p>
        );
      })}
    </article>
  );
}
