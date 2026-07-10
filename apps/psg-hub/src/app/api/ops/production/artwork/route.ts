import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

export const runtime = "nodejs";

type ValidationStatus = "pass" | "warn" | "blocked";

const VALIDATION_STATUSES = ["pass", "warn", "blocked"] as const;

type SurfaceElement =
  | {
      id: string;
      kind: "text";
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
      text: string;
      fontSize?: number;
      fontFamily?: string;
      color?: string;
      [key: string]: unknown;
    }
  | {
      id: string;
      kind: "shape";
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
      fill: string;
      [key: string]: unknown;
    }
  | {
      id: string;
      kind: "image";
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
      src: string;
      [key: string]: unknown;
    };

type ImageSource = {
  dataUrl: string;
  width?: number;
  height?: number;
};

type PersistedSurface = {
  baseGraphic?: ImageSource | null;
  logo?: ImageSource | null;
  baseMeta?: {
    width: number;
    height: number;
  } | null;
  logoMeta?: {
    width: number;
    height: number;
  } | null;
  elements: SurfaceElement[];
};

const imageSourceSchema = z
  .object({
    dataUrl: z.string().trim().min(20).max(6_000_000),
    width: z.number().finite().nonnegative().optional(),
    height: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

const imageElementSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    kind: z.literal("image"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    rotation: z.number().finite().optional(),
    src: z.string().trim().min(20).max(6_000_000),
  })
  .passthrough();

const textElementSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    kind: z.literal("text"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    rotation: z.number().finite().optional(),
    text: z.string().trim().min(1),
    fontSize: z.number().finite().positive().optional(),
    fontFamily: z.string().trim().max(80).optional(),
    color: z.string().trim().max(20).optional(),
  })
  .passthrough();

const shapeElementSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    kind: z.literal("shape"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    rotation: z.number().finite().optional(),
    fill: z.string().trim().min(1),
  })
  .passthrough();

const persistedSurfaceSchema = z
  .object({
    baseGraphic: imageSourceSchema.nullable().optional(),
    logo: imageSourceSchema.nullable().optional(),
    baseMeta: z
      .object({
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
      })
      .nullable()
      .optional(),
    logoMeta: z
      .object({
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
      })
      .nullable()
      .optional(),
    elements: z.array(z.discriminatedUnion("kind", [imageElementSchema, textElementSchema, shapeElementSchema])),
  })
  .passthrough();

const validationSchema = z.object({
  status: z.enum(VALIDATION_STATUSES),
  issues: z.array(z.string().trim().min(1).max(500)),
});

const requestSchema = z.object({
  id: z.string().uuid().optional(),
  size: z.enum(["4x6", "6x9"]),
  name: z.string().trim().min(1).max(120).default("Draft"),
  validation: validationSchema,
  front: persistedSurfaceSchema,
  back: persistedSurfaceSchema,
  phase1Document: z.record(z.string(), z.unknown()),
});

function normalizeIssues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeIssueList(values: unknown) {
  return coerceValidationIssues(values);
}

function selectDesignColumns() {
  return "id, name, size, validation_status, validation_issues, phase1_document, front_state, back_state, created_at, updated_at";
}

function normalizeRow(data: Record<string, unknown>) {
  const validationIssues =
    (Array.isArray((data.validation_issues as unknown) ?? undefined)
      ? normalizeIssues(data.validation_issues)
      : normalizeIssueList(data.validation_issues)) as string[];

  return {
    ...data,
    validation_status: (data.validation_status as ValidationStatus) ?? "pass",
    validation_issues: validationIssues,
    front_state: (data.front_state as PersistedSurface) ?? null,
    back_state: (data.back_state as PersistedSurface) ?? null,
    phase1_document: (data.phase1_document as Record<string, unknown> | null) ?? null,
  };
}

function coerceValidationIssues(values: unknown) {
  if (!Array.isArray(values)) return [];

  return values
    .filter((value): value is string | { message?: unknown; level?: unknown } => {
      return typeof value === "string" || (value !== null && typeof value === "object");
    })
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (typeof value.message === "string") return value.message.trim();
      return "";
    })
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("design_mail_artwork");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const designId = url.searchParams.get("id");
  const service = createServiceClient();

  if (designId) {
    const { data, error } = await service
      .from("mail_artwork_designs")
      .select(selectDesignColumns())
      .eq("created_by_profile_id", gate.userId)
      .eq("id", designId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    return NextResponse.json({
      design: normalizeRow(data as unknown as Record<string, unknown>),
    });
  }

  const { data, error } = await service
    .from("mail_artwork_designs")
    .select(selectDesignColumns())
    .eq("created_by_profile_id", gate.userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const designs = (data ?? []).map((row) => normalizeRow(row as unknown as Record<string, unknown>));

  return NextResponse.json({ designs });
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("design_mail_artwork");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { id, size, name, validation, front, back, phase1Document } = parsed.data;
  const service = createServiceClient();
  const basePayload = {
    created_by_profile_id: gate.userId,
    size,
    name,
    validation_status: validation.status as ValidationStatus,
    validation_issues: validation.issues,
    front_state: front,
    back_state: back,
    phase1_document: phase1Document,
  };

  if (id) {
    const { data: updated, error: updateError } = await service
      .from("mail_artwork_designs")
      .update(basePayload)
      .eq("id", id)
      .eq("created_by_profile_id", gate.userId)
      .select(selectDesignColumns())
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "PGRST116") {
        return NextResponse.json({ error: "Design not found for this user" }, { status: 404 });
      }
      if (updateError.code === "23505") {
        return NextResponse.json({ error: "A design with this ID already exists." }, { status: 409 });
      }
      console.error("[api/ops/production/artwork POST] update failed:", updateError.message);
      return NextResponse.json({ error: "Unable to update design" }, { status: 500 });
    }

    if (updated) {
      return NextResponse.json({ design: normalizeRow(updated as unknown as Record<string, unknown>) }, { status: 200 });
    }

    return NextResponse.json({ error: "Design not found for this user" }, { status: 404 });
  }

  const { data, error } = await service
    .from("mail_artwork_designs")
    .insert(basePayload)
    .select(selectDesignColumns())
    .single();

  if (error) {
    console.error("[api/ops/production/artwork POST] insert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Unable to save design" }, { status: 500 });
  }

  return NextResponse.json(
    {
      design: normalizeRow(data as unknown as Record<string, unknown>),
    },
    { status: 201 },
  );
}
