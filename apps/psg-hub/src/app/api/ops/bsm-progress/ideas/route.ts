import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, isOpsStaff } from "@/lib/auth/ops-access";
import { createBsmIdeaIssue } from "@/lib/bsm-progress";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getOpsAccess(user.id);
  if (!isOpsStaff(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    requesterEmail: user.email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ issueIdentifier: result.issueIdentifier });
}
