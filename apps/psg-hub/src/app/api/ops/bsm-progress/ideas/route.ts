import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createBsmIdeaIssue } from "@/lib/bsm-progress";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";

  if (title.length < 4 || title.length > 120) {
    return NextResponse.json({ error: "Use a title between 4 and 120 characters." }, { status: 400 });
  }

  if (description.length < 10 || description.length > 2000) {
    return NextResponse.json(
      { error: "Use a description between 10 and 2,000 characters." },
      { status: 400 },
    );
  }

  const result = await createBsmIdeaIssue({
    title,
    description,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ issueIdentifier: result.issueIdentifier });
}
