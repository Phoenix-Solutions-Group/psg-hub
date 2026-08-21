import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail/sendgrid";
import { getUserShops } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";

const REQUESTABLE_TOOLS = {
  ads: "Google Ads",
} as const;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { tool?: string };
  try {
    body = (await request.json()) as { tool?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.tool !== "ads") {
    return NextResponse.json({ error: "Unsupported tool" }, { status: 400 });
  }

  const shops = await getUserShops(user.id);
  if (shops.length < 2) {
    return NextResponse.json({ error: "Portfolio request requires multiple locations" }, { status: 400 });
  }
  if (!shops.some((shop) => shop.role === "owner" || shop.role === "manager")) {
    return NextResponse.json({ error: "Owner or manager role required" }, { status: 403 });
  }

  const recipient = process.env.PORTFOLIO_ACCESS_RECIPIENT?.trim();
  if (!recipient) {
    console.error("[portfolio-access] PORTFOLIO_ACCESS_RECIPIENT is not configured");
    return NextResponse.json({ error: "Request delivery unavailable" }, { status: 503 });
  }

  const tool = REQUESTABLE_TOOLS[body.tool];
  const locations = shops
    .map((shop) => `- ${shop.name || shop.id} (${shop.role}) [${shop.id}]`)
    .join("\n");

  try {
    await sendEmail({
      to: recipient,
      subject: `PSG Hub portfolio access request — ${tool}`,
      text: [
        `Requested tool: ${tool}`,
        `User: ${user.email ?? "No email"} [${user.id}]`,
        `Visible locations: ${shops.length}`,
        "",
        locations,
        "",
        "This is a non-binding request. Verify portfolio scope before changing access or billing.",
      ].join("\n"),
      clickTracking: false,
    });
  } catch (error) {
    console.error("[portfolio-access] send failed:", error);
    return NextResponse.json({ error: "Request delivery failed" }, { status: 502 });
  }

  // ponytail: UI confirmation prevents accidental repeat clicks; add persistent
  // idempotency only if real request volume or duplicate delivery warrants it.
  return NextResponse.json({ sent: true });
}
