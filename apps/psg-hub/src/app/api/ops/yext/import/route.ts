import { type NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { importYextSnapshot, type UpsertClient } from "@/lib/yext/import";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const summary = await importYextSnapshot(
      createServiceClient() as unknown as UpsertClient,
      body
    );
    return NextResponse.json({ imported: summary });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.flatten() },
        { status: 422 }
      );
    }
    console.error("[yext/import] failed:", (err as Error).message);
    return NextResponse.json({ error: "Yext import failed" }, { status: 500 });
  }
}
