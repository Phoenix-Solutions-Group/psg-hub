import { NextResponse } from "next/server";

const responseBody = () => ({
  status: "ok",
  service: "psg-hub",
  buildSha:
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown",
  timestamp: new Date().toISOString(),
});

const response = () =>
  NextResponse.json(responseBody(), {
    headers: {
      "cache-control": "no-store",
    },
  });

export async function GET() {
  return response();
}

export const HEAD = GET;
