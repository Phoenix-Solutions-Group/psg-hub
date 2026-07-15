export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import {
  isBsmPilotEventName,
  recordBsmPilotEvent,
  sanitizeBsmPilotEventProperties,
} from "@/lib/bsm/pilot-events";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    eventName?: unknown;
    properties?: unknown;
  } | null;

  if (!isBsmPilotEventName(body?.eventName)) {
    return NextResponse.json({ error: "Unknown event name." }, { status: 400 });
  }

  const { activeShopId } = await getActiveShopContext(user.id);
  const service = createServiceClient();
  await recordBsmPilotEvent(service, {
    eventName: body.eventName,
    shopId: activeShopId,
    userId: user.id,
    properties: sanitizeBsmPilotEventProperties(body.properties),
  });

  return NextResponse.json({ ok: true });
}
