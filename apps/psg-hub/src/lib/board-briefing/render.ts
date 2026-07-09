import "server-only";

export interface BoardBriefingRenderInput {
  body: string;
  briefingUrl: string;
  subject: string;
  generatedAt?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textWithLink(input: BoardBriefingRenderInput): string {
  return [
    input.subject,
    "",
    input.body.trim(),
    "",
    `Read the source briefing: ${input.briefingUrl}`,
    input.generatedAt ? `Generated: ${input.generatedAt}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderBoardBriefingEmail(input: BoardBriefingRenderInput): {
  html: string;
  text: string;
} {
  const escapedBody = escapeHtml(input.body.trim()).replaceAll("\n", "<br>");
  const escapedSubject = escapeHtml(input.subject);
  const escapedUrl = escapeHtml(input.briefingUrl);
  const generated = input.generatedAt
    ? `<p style="margin:16px 0 0;color:#667085;font-size:13px;">Generated: ${escapeHtml(input.generatedAt)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f7f9;color:#101828;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:720px;margin:0 auto;padding:32px 20px;">
      <section style="background:#ffffff;border:1px solid #d0d5dd;border-radius:8px;padding:28px;">
        <p style="margin:0 0 8px;color:#475467;font-size:14px;">Phoenix Solutions Group</p>
        <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:#101828;">${escapedSubject}</h1>
        <div style="font-size:16px;line-height:1.6;color:#344054;">${escapedBody}</div>
        <p style="margin:24px 0 0;">
          <a href="${escapedUrl}" style="color:#175cd3;font-weight:700;text-decoration:none;">Read the source briefing</a>
        </p>
        ${generated}
      </section>
    </main>
  </body>
</html>`;

  return {
    html,
    text: textWithLink(input),
  };
}
