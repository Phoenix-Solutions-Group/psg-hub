import { describe, expect, it } from "vitest";
import { parseSpcReport, spcStableId } from "../spc-sync";

describe("SPC report parsing", () => {
  it("parses quoted CSV, convective-day rollover, hail magnitude, and Python-compatible IDs", () => {
    const csv = [
      "Time,Size,Location,County,State,Lat,Lon,Comments",
      '0230,125,2 W TEST,SEDGWICK,KS,37.65,-97.42,"Hail, measured"',
    ].join("\n");
    const row = {
      Time: "0230",
      Size: "125",
      Location: "2 W TEST",
      County: "SEDGWICK",
      State: "KS",
      Lat: "37.65",
      Lon: "-97.42",
      Comments: "Hail, measured",
    };

    const events = parseSpcReport("2026-08-17", "hail", csv, "batch-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      begin_time: "2026-08-18T02:30:00.000Z",
      magnitude: 1.25,
      magnitude_type: "IN",
      state: "KS",
      raw_payload: {
        report_date: "2026-08-17",
        report_type: "hail",
        state: "KS",
      },
    });
    expect(events[0].source_event_id).toBe("347288979480476824");
    expect(spcStableId("2026-08-17", "hail", row)).toBe("347288979480476824");
  });

  it("rejects malformed coordinates before any database call", () => {
    const csv = [
      "Time,Speed,Location,County,State,Lat,Lon,Comments",
      "1400,60,TEST,SEDGWICK,KS,999,-97.42,Bad coordinate",
    ].join("\n");
    expect(() => parseSpcReport("2026-08-17", "wind", csv, "batch-1")).toThrow(
      /latitude/,
    );
  });
});
