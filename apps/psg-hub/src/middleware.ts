import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // PSG-500: `get-started` is the public, unauthenticated inbound lead-capture
    // page (parent PSG-493) and is excluded here so no Supabase session work runs
    // on it and it stays reachable without a login. Everything else is still
    // matched, so the rest of the hub remains gated.
    "/((?!get-started|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
