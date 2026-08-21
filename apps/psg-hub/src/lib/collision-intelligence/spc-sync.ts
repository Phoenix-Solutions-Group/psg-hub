import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE_KEY = "noaa_spc_preliminary_reports";
const SOURCE_URL = "https://www.spc.noaa.gov/climo/reports/";
const REPORT_TYPES = {
  torn: { eventType: "Tornado", weight: 4.5 },
  hail: { eventType: "Hail", weight: 5 },
  wind: { eventType: "Thunderstorm Wind", weight: 4 },
} as const;

type ReportType = keyof typeof REPORT_TYPES;
type CsvRow = Record<string, string>;
type FetchLike = typeof fetch;

type SpcEvent = {
  source: typeof SOURCE_KEY;
  source_event_id: string;
  event_type: string;
  event_type_normalized: string;
  begin_time: string;
  end_time: string;
  state: string | null;
  source_year: number;
  source_month: number;
  month_name: string;
  magnitude: number | null;
  magnitude_type: "IN" | "MPH" | null;
  begin_lat: number;
  begin_lng: number;
  end_lat: number;
  end_lng: number;
  repair_demand_weight: number;
  import_batch_id: string;
  raw_payload: {
    report_date: string;
    report_type: ReportType;
    state: string | null;
  };
};

export type SpcSyncResult = {
  refreshedDays: number;
  skippedDays: number;
  imported: number;
  latestEventAt: string | null;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("SPC CSV contains an unclosed quoted field");
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function csvObjects(text: string): CsvRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((values) => {
    const row = Object.fromEntries(
      header.map((name, index) => [name.trim(), values[index] ?? ""]),
    );
    const extras = values.slice(header.length);

    // SPC occasionally emits one extra empty location field. This is the same
    // documented repair used by the one-time Python importer.
    if (/^[A-Za-z]{2}$/.test(row.Lat ?? "") && extras.length > 0) {
      row.County = row.State ?? "";
      row.State = row.Lat;
      row.Lat = row.Lon ?? "";
      row.Lon = row.Comments ?? "";
      row.Comments = extras.join(",");
    } else if (extras.some((value) => value.trim())) {
      throw new Error("SPC CSV row has unexpected extra columns");
    }
    return row;
  });
}

function pythonJsonString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function pythonSortedJson(row: CsvRow): string {
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${pythonJsonString(key)}: ${pythonJsonString(row[key])}`)
    .join(", ")}}`;
}

export function spcStableId(
  reportDate: string,
  reportType: ReportType,
  row: CsvRow,
): string {
  const identity = `${reportDate}|${reportType}|${pythonSortedJson(row)}`;
  const prefix = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 15);
  return BigInt(`0x${prefix}`).toString();
}

function reportTimestamp(reportDate: string, rawTime: string): Date {
  const value = rawTime.trim().padStart(4, "0");
  if (!/^\d{4}$/.test(value))
    throw new Error(`Invalid SPC report time: ${rawTime}`);
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  if (hour > 23 || minute > 59)
    throw new Error(`Invalid SPC report time: ${rawTime}`);

  const timestamp = new Date(
    `${reportDate}T${value.slice(0, 2)}:${value.slice(2)}:00Z`,
  );
  if (hour < 12) timestamp.setUTCDate(timestamp.getUTCDate() + 1);
  return timestamp;
}

function coordinate(
  value: string,
  label: string,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid SPC ${label}: ${value}`);
  }
  return parsed;
}

function magnitude(reportType: ReportType, row: CsvRow): number | null {
  if (reportType === "torn") return null;
  const raw = row[reportType === "hail" ? "Size" : "Speed"]?.trim();
  if (!raw || raw.toUpperCase() === "UNK") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`Invalid SPC magnitude: ${raw}`);
  return reportType === "hail" ? parsed / 100 : parsed;
}

export function parseSpcReport(
  reportDate: string,
  reportType: ReportType,
  csv: string,
  batchId: string,
): SpcEvent[] {
  const config = REPORT_TYPES[reportType];
  return csvObjects(csv).map((row) => {
    const eventAt = reportTimestamp(reportDate, row.Time);
    const latitude = coordinate(row.Lat, "latitude", -90, 90);
    const longitude = coordinate(row.Lon, "longitude", -180, 180);
    return {
      source: SOURCE_KEY,
      source_event_id: spcStableId(reportDate, reportType, row),
      event_type: config.eventType,
      event_type_normalized: config.eventType.toLowerCase(),
      begin_time: eventAt.toISOString(),
      end_time: eventAt.toISOString(),
      state: row.State?.trim() || null,
      source_year: eventAt.getUTCFullYear(),
      source_month: eventAt.getUTCMonth() + 1,
      month_name: eventAt.toLocaleString("en-US", {
        month: "long",
        timeZone: "UTC",
      }),
      magnitude: magnitude(reportType, row),
      // SPC report tables publish wind `Speed` in MPH; the alert view uses 58 MPH.
      magnitude_type:
        reportType === "hail" ? "IN" : reportType === "wind" ? "MPH" : null,
      begin_lat: latitude,
      begin_lng: longitude,
      end_lat: latitude,
      end_lng: longitude,
      repair_demand_weight: config.weight,
      import_batch_id: batchId,
      raw_payload: {
        report_date: reportDate,
        report_type: reportType,
        state: row.State?.trim() || null,
      },
    };
  });
}

function dateOffset(date: Date, offset: number): string {
  const shifted = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + offset,
    ),
  );
  return shifted.toISOString().slice(0, 10);
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function reportUrl(reportDate: string, reportType: ReportType): string {
  return `${SOURCE_URL}${compactDate(reportDate).slice(2)}_rpts_${reportType}.csv`;
}

async function fetchDay(
  reportDate: string,
  fetchFn: FetchLike,
): Promise<Record<ReportType, string> | null> {
  const entries = await Promise.all(
    (Object.keys(REPORT_TYPES) as ReportType[]).map(async (reportType) => {
      const response = await fetchFn(reportUrl(reportDate, reportType), {
        cache: "no-store",
        headers: { "User-Agent": "PSG collision intelligence sync" },
      });
      if (response.status === 404) return [reportType, null] as const;
      if (!response.ok)
        throw new Error(
          `SPC ${reportType} fetch failed: HTTP ${response.status}`,
        );
      return [reportType, await response.text()] as const;
    }),
  );
  if (entries.some(([, csv]) => csv === null)) return null;
  return Object.fromEntries(entries) as Record<ReportType, string>;
}

export async function syncSpcReports(
  service: SupabaseClient,
  options: { now?: Date; fetchFn?: FetchLike; reportDates?: string[] } = {},
): Promise<SpcSyncResult> {
  const now = options.now ?? new Date();
  const fetchFn = options.fetchFn ?? fetch;
  const reportDates =
    options.reportDates ?? [-2, -1, 0].map((offset) => dateOffset(now, offset));
  const result: SpcSyncResult = {
    refreshedDays: 0,
    skippedDays: 0,
    imported: 0,
    latestEventAt: null,
  };

  for (const reportDate of reportDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))
      throw new Error(`Invalid report date: ${reportDate}`);
    const csvByType = await fetchDay(reportDate, fetchFn);
    if (!csvByType) {
      result.skippedDays += 1;
      continue;
    }

    const cycle = compactDate(reportDate);
    const batchId = `spc_${cycle}`;
    const events = (Object.keys(REPORT_TYPES) as ReportType[]).flatMap(
      (reportType) =>
        parseSpcReport(reportDate, reportType, csvByType[reportType], batchId),
    );
    const windowStart = `${reportDate}T12:00:00.000Z`;
    const windowEnd = `${dateOffset(new Date(`${reportDate}T12:00:00Z`), 1)}T12:00:00.000Z`;
    const { data, error } = await service.rpc(
      "replace_spc_preliminary_events",
      {
        p_window_start: windowStart,
        p_window_end: windowEnd,
        p_events: events,
        p_source: {
          source_key: SOURCE_KEY,
          source_url: SOURCE_URL,
          file_family: "daily_reports",
          source_year: Number(reportDate.slice(0, 4)),
          cycle,
          file_url: `${SOURCE_URL}YYMMDD_rpts_TYPE.csv`,
          row_count: events.length,
          status: "loaded_provisional",
          import_batch_id: batchId,
          notes: `Atomic SPC preliminary report snapshot for convective day ${reportDate}.`,
        },
      },
    );
    if (error)
      throw new Error(`SPC database replacement failed: ${error.message}`);

    result.refreshedDays += 1;
    result.imported += Number(data ?? events.length);
    const latest =
      events
        .map((event) => event.begin_time)
        .sort()
        .at(-1) ?? null;
    if (latest && (!result.latestEventAt || latest > result.latestEventAt))
      result.latestEventAt = latest;
  }

  if (result.refreshedDays === 0)
    throw new Error("No complete SPC report day was available");
  return result;
}
