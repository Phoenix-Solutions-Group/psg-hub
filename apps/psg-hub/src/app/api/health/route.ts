import { NextResponse } from "next/server";

const buildIdentifier = () =>
  [process.env.VERCEL_GIT_COMMIT_SHA, process.env.GIT_COMMIT_SHA].find(
    (value) => value?.trim()
  ) ?? "unknown";

const healthResponse = () =>
  NextResponse.json(
    {
      status: "ok",
      service: "psg-hub",
      timestamp: new Date().toISOString(),
      buildSha: buildIdentifier(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );

export async function GET() {
  return healthResponse();
}

export const HEAD = GET;
