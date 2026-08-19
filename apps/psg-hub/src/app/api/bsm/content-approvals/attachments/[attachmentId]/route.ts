export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  BsmCustomerReviewError,
  getBsmReviewCommentAttachmentDownload,
} from "@/lib/bsm/customer-content-review";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[/\\"]/g, "-")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "reply-photo"
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const { attachmentId } = await params;
  if (!UUID_RE.test(attachmentId)) {
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
    const attachment = await getBsmReviewCommentAttachmentDownload(supabase, attachmentId, user.id);
    return new Response(attachment.data, {
      status: 200,
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(attachment.byteSize),
        "Content-Disposition": `inline; filename="${safeFilename(attachment.originalFilename)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof BsmCustomerReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
