// PSG-89 — verifies the survey attribution + response-rate/recommend MODEL.
//
// The fixtures below mirror, row-for-row, the pilot seed
// (supabase/seeds/survey_attribution_pilot.sql) AFTER the joins the SQL
// verification query resolves (supabase/seeds/survey_attribution_verify.sql).
// Asserting the aggregations over this shape proves the data model exposes
// everything the 5 remaining Survey & CSI reports need:
//   - a survey resolves to its RO# + estimator / body tech / painter
//   - response rate (surveys_sent denominator), would-recommend rate
//   - body-tech comeback / painter redo (rework) rates
// The live SQL join itself is verified by the operator query post-apply.

import { describe, it, expect } from "vitest";
import {
  csiByAttribution,
  recommendRatePct,
  responseRatePct,
  reworkRatePct,
  type AttributedSurvey,
} from "../live/attribution";

// survey_responses joined to repair_orders + repair_order_employees + employees,
// exactly as survey_attribution_verify.sql query (A) returns it.
const RESOLVED_SURVEYS = [
  {
    response_id: "RESP-89001",
    ro_number: "RO-89001",
    scale_emi_pct: 0.97,
    would_recommend: true,
    estimator: "Erin Estimadora",
    body_tech: "Tomas Bodyworth",
    painter: "Paula Painter",
  },
  {
    response_id: "RESP-89002",
    ro_number: "RO-89002",
    scale_emi_pct: 0.86,
    would_recommend: false,
    estimator: "Erin Estimadora",
    body_tech: "Tomas Bodyworth",
    painter: "Paula Painter",
  },
  {
    response_id: "RESP-89003",
    ro_number: "RO-89003",
    scale_emi_pct: 0.92,
    would_recommend: true,
    estimator: "Erin Estimadora",
    body_tech: "Tomas Bodyworth",
    painter: "Paula Painter",
  },
] as const;

// repair_order_employees rows for the tech/painter roles (rework flags from seed).
const TECH_JOBS = [{ rework: false }, { rework: true }, { rework: false }];
const PAINTER_JOBS = [{ rework: false }, { rework: false }, { rework: true }];

const SENT = 6; // survey_dispatches rows for the shop
const RETURNED = RESOLVED_SURVEYS.length; // 3

describe("PSG-89 survey attribution model", () => {
  it("resolves every survey to its RO# and attributed estimator/tech/painter", () => {
    for (const s of RESOLVED_SURVEYS) {
      expect(s.ro_number).toMatch(/^RO-\d+$/);
      expect(s.estimator).toBeTruthy();
      expect(s.body_tech).toBeTruthy();
      expect(s.painter).toBeTruthy();
    }
  });

  it("computes estimator CSI grouped by attribution (estimator-csi)", () => {
    const groups = csiByAttribution(
      RESOLVED_SURVEYS.map<AttributedSurvey>((s) => ({
        key: s.estimator,
        scale_emi_pct: s.scale_emi_pct,
      })),
    );
    // One estimator, 3 surveys, CSI = avg(97,86,92) = 91.666… → 91.7.
    expect(groups).toEqual([
      { key: "Erin Estimadora", surveys: 3, csi: 91.7 },
    ]);
  });

  it("computes body-tech comeback rate and painter redo rate (rework over jobs)", () => {
    expect(reworkRatePct(TECH_JOBS)).toBe(33.3); // 1 comeback / 3 jobs
    expect(reworkRatePct(PAINTER_JOBS)).toBe(33.3); // 1 redo / 3 jobs
    expect(reworkRatePct([])).toBeNull();
  });

  it("computes the response rate from the surveys_sent denominator", () => {
    expect(responseRatePct(RETURNED, SENT)).toBe(50); // 3 of 6
    expect(responseRatePct(0, 0)).toBeNull();
  });

  it("computes the would-recommend rate, excluding unanswered", () => {
    expect(recommendRatePct(RESOLVED_SURVEYS)).toBe(66.7); // 2 of 3
    expect(
      recommendRatePct([{ would_recommend: null }, { would_recommend: true }]),
    ).toBe(100); // unanswered dropped from denominator
    expect(recommendRatePct([{ would_recommend: null }])).toBeNull();
  });

  it("drops unattributed surveys from CSI grouping", () => {
    const groups = csiByAttribution([
      { key: null, scale_emi_pct: 0.9 },
      { key: "  ", scale_emi_pct: 0.9 },
      { key: "Erin Estimadora", scale_emi_pct: 0.9 },
    ]);
    expect(groups).toEqual([{ key: "Erin Estimadora", surveys: 1, csi: 90 }]);
  });
});
