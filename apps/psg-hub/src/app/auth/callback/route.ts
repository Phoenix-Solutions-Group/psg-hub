import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

type OtpType =
  | "signup"
  | "recovery"
  | "invite"
  | "email_change"
  | "email"
  | "magiclink"
  | "phone_change";

function resolveNextPath(rawNext: string | null, fallback: string): string {
  if (!rawNext) return fallback;
  if (!rawNext.startsWith("/")) return fallback;
  return rawNext;
}

function buildCallbackClient(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
}

function normalizeOtpType(rawType: string | null): OtpType | null {
  const type = (rawType ?? "").toLowerCase();
  switch (type) {
    case "signup":
    case "recovery":
    case "invite":
    case "email_change":
    case "email":
    case "magiclink":
    case "phone_change":
      return type;
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const token = requestUrl.searchParams.get("token");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const next = resolveNextPath(requestUrl.searchParams.get("next"), "/dashboard");
  const otpType = normalizeOtpType(requestUrl.searchParams.get("type"));

  const response = NextResponse.redirect(
    new URL(next, requestUrl.origin),
    { status: 302 }
  );
  const supabase = buildCallbackClient(request, response);

  function redirectTo(path: string) {
    response.headers.set("location", new URL(resolveNextPath(path, "/dashboard"), requestUrl.origin).toString());
    return response;
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchange code failed:", error.message);
      return NextResponse.json({ error: "Failed to process callback code." }, { status: 400 });
    }

    return redirectTo(next);
  }

  if (token && tokenHash) {
    const type = otpType ?? "recovery";
    const { error } = await supabase.auth.verifyOtp({
      type,
      token,
      token_hash: tokenHash,
    });
    if (error) {
      console.error("[auth/callback] OTP verification failed:", error.message);
      return NextResponse.json({ error: "Failed to process recovery link." }, { status: 400 });
    }

    const destination = type === "recovery" ? "/auth/reset-password" : "/dashboard";
    return redirectTo(resolveNextPath(requestUrl.searchParams.get("next"), destination));
  }

  return NextResponse.json({ error: "Missing callback parameters." }, { status: 400 });
}
