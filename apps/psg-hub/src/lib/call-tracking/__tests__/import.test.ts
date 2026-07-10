import { describe, expect, it } from "vitest";
import {
  mapCallRailRow,
  mapWhatConvertsRow,
  summarizeCallTrackingRows,
  toCallTrackingInsertRow,
} from "../import";

const SHOP_ID = "11111111-1111-1111-1111-111111111111";

describe("call tracking import mapping", () => {
  it("maps CallRail-style exports to the canonical storage row", () => {
    const row = mapCallRailRow(SHOP_ID, {
      "Call ID": "cr-123",
      "Start Time": "2026-07-01T14:30:00Z",
      "Duration (seconds)": "94",
      Source: "Google Ads",
      Campaign: "Collision Repair",
      Qualified: "yes",
      "Tracking Number": "(555) 123-4567",
    });

    expect(row).toMatchObject({
      shop_id: SHOP_ID,
      provider: "callrail",
      provider_call_id: "cr-123",
      idempotency_key: "cr-123",
      call_started_at: "2026-07-01T14:30:00Z",
      duration_seconds: 94,
      source: "Google Ads",
      campaign: "Collision Repair",
      qualified: true,
      tracking_number: "5551234567",
    });
  });

  it("maps WhatConverts-style exports and avoids storing caller phone fields", () => {
    const row = mapWhatConvertsRow(SHOP_ID, {
      "Lead ID": "wc-9",
      Date: "2026-07-02T09:15:00Z",
      "Call Duration": "31",
      "Lead Source": "Organic Search",
      Campaign: "Main",
      Quotable: "No",
      "Caller Number": "555-999-0000",
    });

    expect(row).toMatchObject({
      provider: "whatconverts",
      provider_call_id: "wc-9",
      source: "Organic Search",
      campaign: "Main",
      qualified: false,
    });
    expect(Object.keys(row)).not.toContain("caller_number");
  });

  it("builds a stable fallback idempotency key when provider ids are missing", () => {
    const base = {
      shopId: SHOP_ID,
      provider: "other" as const,
      startedAt: "2026-07-03T10:00:00Z",
      source: "Google Ads",
      campaign: "Estimate calls",
      trackingNumber: "555-123-4567",
    };

    const a = toCallTrackingInsertRow(base);
    const b = toCallTrackingInsertRow(base);
    const c = toCallTrackingInsertRow({ ...base, startedAt: "2026-07-03T10:05:00Z" });

    expect(a.idempotency_key).toBe(b.idempotency_key);
    expect(a.idempotency_key).not.toBe(c.idempotency_key);
  });

  it("rejects rows without a usable call start date", () => {
    expect(() =>
      toCallTrackingInsertRow({
        shopId: SHOP_ID,
        provider: "callrail",
        startedAt: "",
      }),
    ).toThrow(/call start date/i);
  });

  it("summarizes total and qualified calls by shop, date, source, and campaign", () => {
    const rows = [
      toCallTrackingInsertRow({
        shopId: SHOP_ID,
        provider: "callrail",
        providerCallId: "a",
        startedAt: "2026-07-01T08:00:00Z",
        source: "Google Ads",
        campaign: "Collision",
        qualified: true,
      }),
      toCallTrackingInsertRow({
        shopId: SHOP_ID,
        provider: "callrail",
        providerCallId: "b",
        startedAt: "2026-07-01T09:00:00Z",
        source: "Google Ads",
        campaign: "Collision",
        qualified: false,
      }),
    ];

    expect(summarizeCallTrackingRows(rows)).toEqual([
      {
        shopId: SHOP_ID,
        date: "2026-07-01",
        source: "Google Ads",
        campaign: "Collision",
        totalCalls: 2,
        qualifiedCalls: 1,
      },
    ]);
  });
});
