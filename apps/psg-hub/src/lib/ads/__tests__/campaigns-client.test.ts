import { describe, it, expect } from "vitest";
import {
  validateCampaignCreate,
  validateBudgetDelta,
  selectCampaignControls,
  formatMicrosAsUsd,
  dollarsToMicros,
  readMetrics,
  formatSyncErrors,
} from "@/lib/ads/campaigns-client";

describe("validateCampaignCreate", () => {
  const cap = 500_000_000;
  it("empty name → name_empty", () => {
    expect(
      validateCampaignCreate({ name: "  ", dailyBudgetMicros: 1e7, maxDailyMicros: cap })
    ).toEqual({ ok: false, reason: "name_empty" });
  });
  it(">255 chars → name_too_long", () => {
    expect(
      validateCampaignCreate({
        name: "x".repeat(256),
        dailyBudgetMicros: 1e7,
        maxDailyMicros: cap,
      })
    ).toEqual({ ok: false, reason: "name_too_long" });
  });
  it("budget ≤0 → budget_invalid", () => {
    expect(
      validateCampaignCreate({ name: "ok", dailyBudgetMicros: 0, maxDailyMicros: cap })
    ).toEqual({ ok: false, reason: "budget_invalid" });
  });
  it("budget > cap → budget_over_cap", () => {
    expect(
      validateCampaignCreate({ name: "ok", dailyBudgetMicros: cap + 1, maxDailyMicros: cap })
    ).toEqual({ ok: false, reason: "budget_over_cap" });
  });
  it("valid → ok:true", () => {
    expect(
      validateCampaignCreate({ name: "ok", dailyBudgetMicros: 5e7, maxDailyMicros: cap })
    ).toEqual({ ok: true });
  });
});

describe("validateBudgetDelta", () => {
  it("100 → 149 ok", () => {
    expect(validateBudgetDelta(100, 149)).toEqual({ ok: true });
  });
  it("100 → 151 fail", () => {
    expect(validateBudgetDelta(100, 151)).toEqual({
      ok: false,
      reason: "delta_exceeds_50",
    });
  });
  it("0 → 50 ok (first budget)", () => {
    expect(validateBudgetDelta(0, 50)).toEqual({ ok: true });
  });
  it("100 → 50 ok (-50% boundary)", () => {
    expect(validateBudgetDelta(100, 50)).toEqual({ ok: true });
  });
  it("negative → invalid", () => {
    expect(validateBudgetDelta(100, -1)).toEqual({
      ok: false,
      reason: "budget_invalid",
    });
  });
});

describe("selectCampaignControls", () => {
  it("owner + paused → canEnable + canEditBudget + canDelete", () => {
    const c = selectCampaignControls("owner", "paused");
    expect(c.canEnable).toBe(true);
    expect(c.canDelete).toBe(true);
    expect(c.canPause).toBe(false);
    expect(c.canEditBudget).toBe(true);
  });
  it("manager + paused → no enable, no delete", () => {
    const c = selectCampaignControls("manager", "paused");
    expect(c.canEnable).toBe(false);
    expect(c.canDelete).toBe(false);
    expect(c.canEditBudget).toBe(true);
  });
  it("viewer + anything → nothing", () => {
    const c = selectCampaignControls("viewer", "enabled");
    expect(c).toEqual({
      canPause: false,
      canEnable: false,
      canEditBudget: false,
      canDelete: false,
    });
  });
  it("owner + removed → only canEditBudget=false, canDelete=false", () => {
    const c = selectCampaignControls("owner", "removed");
    expect(c.canDelete).toBe(false);
  });
});

describe("formatMicrosAsUsd", () => {
  it("0 → $0.00", () => expect(formatMicrosAsUsd(0)).toBe("$0.00"));
  it("1M → $1.00", () => expect(formatMicrosAsUsd(1_000_000)).toBe("$1.00"));
  it("1.5M → $1.50", () => expect(formatMicrosAsUsd(1_500_000)).toBe("$1.50"));
  it("500M → $500.00", () =>
    expect(formatMicrosAsUsd(500_000_000)).toBe("$500.00"));
  it("null/undefined/NaN → $0.00", () => {
    expect(formatMicrosAsUsd(null)).toBe("$0.00");
    expect(formatMicrosAsUsd(undefined)).toBe("$0.00");
    expect(formatMicrosAsUsd(Number.NaN)).toBe("$0.00");
  });
});

describe("dollarsToMicros", () => {
  it("50 → 50_000_000", () => {
    expect(dollarsToMicros(50)).toEqual({ ok: true, micros: 50_000_000 });
  });
  it("50.50 → 50_500_000", () => {
    expect(dollarsToMicros(50.5)).toEqual({ ok: true, micros: 50_500_000 });
  });
  it("50.555 → precision_exceeded", () => {
    expect(dollarsToMicros(50.555)).toEqual({
      ok: false,
      reason: "precision_exceeded",
    });
  });
  it("0 → non_positive", () => {
    expect(dollarsToMicros(0)).toEqual({ ok: false, reason: "non_positive" });
  });
  it("-1 → non_positive", () => {
    expect(dollarsToMicros(-1)).toEqual({
      ok: false,
      reason: "non_positive",
    });
  });
  it("NaN → not_finite", () => {
    expect(dollarsToMicros(Number.NaN)).toEqual({
      ok: false,
      reason: "not_finite",
    });
  });
  it("Infinity → not_finite", () => {
    expect(dollarsToMicros(Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      reason: "not_finite",
    });
  });
});

describe("readMetrics", () => {
  it("empty object returns zeros", () => {
    expect(readMetrics({ metrics: {} })).toEqual({
      impressions: 0,
      clicks: 0,
      cost_micros: 0,
      conversions: 0,
    });
  });
  it("null metrics returns zeros", () => {
    expect(readMetrics({ metrics: null })).toEqual({
      impressions: 0,
      clicks: 0,
      cost_micros: 0,
      conversions: 0,
    });
  });
  it("partial metrics — missing fields default to 0", () => {
    expect(readMetrics({ metrics: { clicks: 5 } })).toEqual({
      impressions: 0,
      clicks: 5,
      cost_micros: 0,
      conversions: 0,
    });
  });
  it("string-coerced numbers parsed", () => {
    expect(readMetrics({ metrics: { impressions: "42" } }).impressions).toBe(
      42
    );
  });
  it("null field → 0", () => {
    expect(readMetrics({ metrics: { impressions: null } }).impressions).toBe(0);
  });
});

describe("formatSyncErrors", () => {
  it("maps id → name", () => {
    const out = formatSyncErrors(
      [{ id: "c1", message: "rate_limited" }],
      [{ id: "c1", name: "Storm Campaign" }]
    );
    expect(out[0]).toContain("Storm Campaign");
    expect(out[0]).toContain("rate_limited");
  });
  it("fallback when name missing", () => {
    const out = formatSyncErrors(
      [{ id: "abcd1234567890", message: "fail" }],
      []
    );
    expect(out[0]).toContain("campaign abcd1234");
  });
  it("truncates to first 2", () => {
    const errors = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      message: "x",
    }));
    expect(formatSyncErrors(errors, []).length).toBe(2);
  });
});
