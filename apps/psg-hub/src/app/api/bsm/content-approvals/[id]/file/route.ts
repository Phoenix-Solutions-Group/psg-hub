export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  BsmCustomerReviewError,
  getBsmReviewCurrentFileDownload,
} from "@/lib/bsm/customer-content-review";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[/\\"]/g, "-")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "review-file"
  );
}

function dispositionFor(contentType: string, filename: string): string {
  const inlineTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/markdown",
    "text/plain",
  ]);
  const disposition = inlineTypes.has(contentType) ? "inline" : "attachment";
  return `${disposition}; filename="${safeFilename(filename)}"`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const file = await getBsmReviewCurrentFileDownload(supabase, id, user.id);
    return new Response(file.data, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.byteSize),
        "Content-Disposition": dispositionFor(file.contentType, file.originalFilename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof BsmCustomerReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
