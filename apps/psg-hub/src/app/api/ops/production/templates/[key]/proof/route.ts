// PSG-217 / PSG-115b — proof screen data. GET the exact merged HTML for a
// template rendered on deterministic sample data, plus the engine's
// missing-`{{token}}` report and the content hash a sign-off binds to.
// format=json (default) returns the structured proof; format=html returns the
// rendered piece HTML for an inline iframe preview. Gated by manage_production.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { buildTemplateProof, isTemplateKey } from "@/lib/production/template-gate";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "Unknown template key" }, { status: 404 });
  }

  const proof = buildTemplateProof(key);
  const format = (request.nextUrl.searchParams.get("format") ?? "json").toLowerCase();

  if (format === "html") {
    // The first rendered surface (postcard front, or letter body). Surface=back
    // can be requested explicitly for postcards.
    const surface = request.nextUrl.searchParams.get("surface");
    const html =
      surface === "back"
        ? proof.content.back
        : proof.content.front ?? proof.content.file;
    if (!html) {
      return NextResponse.json({ error: "No rendered surface for this template" }, { status: 404 });
    }
    return new NextResponse(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.json({ proof });
}
