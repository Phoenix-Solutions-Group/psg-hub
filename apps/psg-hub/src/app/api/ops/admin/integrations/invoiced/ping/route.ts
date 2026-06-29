// Invoiced.app read-only connection test — PSG-422.
// GET /api/ops/admin/integrations/invoiced/ping
// Superadmin-gated (mirrors the CCC integrations routes — an operator-only probe of
// an external billing account). Runs `pingInvoiced()` against the deployed env and
// returns reachable + the resolved env var NAME + best-effort account identity.
//
// This is a connection test ONLY: no DB write, no audit row (nothing mutates), no
// vendor spend (single read against the sandbox account by default). The response
// never contains the API key or its value — only `keySource` (the var NAME) so the
// operator can confirm which Vercel env var Nick actually set.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { pingInvoiced } from "@/lib/billing/invoiced/client";

export async function GET() {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const result = await pingInvoiced();

  // 200 with reachable:true on green; 502 on red so the operator sees a non-2xx
  // for a failed connection while still getting the structured detail.
  return NextResponse.json(result, { status: result.reachable ? 200 : 502 });
}
