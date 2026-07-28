import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addBsmCustomerReviewComment, BsmCustomerReviewError } from "@/lib/bsm/customer-content-review";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const photos = formData
        .getAll("photo")
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (photos.length > 1) {
        return NextResponse.json({ error: "Attach only one photo to this reply." }, { status: 400 });
      }
      const photo = photos[0] ?? null;
      if (photo != null && !(photo instanceof File)) {
        return NextResponse.json({ error: "Attach one JPG, PNG, or WebP photo." }, { status: 400 });
      }
      const comment = await addBsmCustomerReviewComment(
        supabase,
        id,
        user.id,
        formData.get("body"),
        photo
          ? {
              fileName: photo.name,
              contentType: photo.type,
              byteSize: photo.size,
              bytes: await photo.arrayBuffer(),
            }
          : null,
      );
      return NextResponse.json({ comment }, { status: 201 });
    }

    const body = (await request.json().catch(() => null)) as { body?: unknown } | null;
    const comment = await addBsmCustomerReviewComment(supabase, id, user.id, body?.body);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    if (error instanceof BsmCustomerReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
