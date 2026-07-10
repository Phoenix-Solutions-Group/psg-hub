// PSG-217 / PSG-115b — seed-test path. POST { to? } sends ONE proof piece for a
// template through the Lob adapter end-to-end, in Lob TEST mode only (free, never
// mailed). A live_* key is refused (403) so a seed test can never incur spend —
// live mailing stays behind gate G4. Gated by manage_production.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createMailAdapter } from "@/lib/production/adapters";
import { buildMailDocument, defaultTemplate } from "@/lib/production/templates";
import {
  SAMPLE_MERGE_DATA,
  isTemplateKey,
} from "@/lib/production/template-gate";
import {
  DEFAULT_SEED_ADDRESS,
  LiveLobKeyError,
  SEED_FROM_ADDRESS,
  assertLobTestMode,
} from "@/lib/production/seed-test";
import { MailProductionError, type MailAddress } from "@/lib/production/types";

const addressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(2).max(2),
  zip: z.string().trim().min(5).max(10),
  country: z.string().trim().max(2).nullish(),
});
const sizeSchema = z.enum(["6x18_bifold", "11x9_bifold", "12x9_bifold", "17.75x9_trifold"]);

const bodySchema = z
  .object({
    to: addressSchema.nullish(),
    size: sizeSchema.nullish(),
  })
  .nullish();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "Unknown template key" }, { status: 404 });
  }

  // Body is optional (defaults to the seed address); tolerate an empty body.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const to: MailAddress = parsed.data?.to
    ? { ...parsed.data.to, addressLine2: parsed.data.to.addressLine2 ?? undefined, country: parsed.data.to.country ?? "US" }
    : DEFAULT_SEED_ADDRESS;

  // Hard safety: seed tests run in Lob TEST mode only — never with a live key.
  try {
    assertLobTestMode(process.env.LOB_API_KEY);
  } catch (error) {
    if (error instanceof LiveLobKeyError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const template = {
    ...defaultTemplate(key),
    ...(parsed.data?.size ? { size: parsed.data.size } : {}),
  };
  const { document, missing } = buildMailDocument({
    template,
    data: SAMPLE_MERGE_DATA,
    documentId: `seedtest-${key}-${Date.now()}`,
    to,
    from: SEED_FROM_ADDRESS,
    description: `Seed test — ${key}`,
    metadata: { seedTest: "true", templateKey: key },
  });

  try {
    const result = await createMailAdapter("lob").submit(document);
    return NextResponse.json(
      { mode: "lob_test", result, missingTokens: missing },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof MailProductionError) {
      const status = error.retryable ? 502 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[ops/production/templates/seed-test]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Seed test failed" }, { status: 500 });
  }
}
