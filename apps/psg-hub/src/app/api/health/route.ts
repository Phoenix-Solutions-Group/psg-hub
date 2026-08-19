import { NextResponse } from "next/server";

const responseBody = () => ({
  status: "ok",
  service: "psg-hub",
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
