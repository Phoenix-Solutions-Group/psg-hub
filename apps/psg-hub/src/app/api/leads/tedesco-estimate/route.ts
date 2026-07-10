import { NextResponse } from "next/server";

// Tedesco Auto Body has been dropped as a client (PSG-1028). Keep this legacy
// endpoint present so old forms and cached pages fail closed instead of sending
// leads into a removed customer workflow.

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "This Tedesco lead form is no longer available.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
