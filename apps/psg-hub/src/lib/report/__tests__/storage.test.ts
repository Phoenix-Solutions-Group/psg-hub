import { describe, it, expect, vi } from "vitest";
import {
  storeReportPdf,
  storeReportNarrative,
  loadReportNarrative,
  REPORTS_BUCKET,
  type ReportStorage,
} from "@/lib/report/storage";
import type { ReportNarrative } from "@/lib/report/schema";

const SHOP = "11111111-1111-1111-1111-111111111111";
const PERIOD = "2026-05";

const narrative: ReportNarrative = {
  headline: "A steady month",
  executiveSummary: "Growth across channels.",
  sourceSummaries: { ga4: "Sessions up." },
  recommendations: ["Keep going."],
};

type StorageOverrides = {
  upload?: ReturnType<typeof vi.fn>;
  download?: ReturnType<typeof vi.fn>;
};

function mockStorage(overrides: StorageOverrides = {}) {
  const upload =
    overrides.upload ?? vi.fn(async () => ({ data: { path: "x" }, error: null }));
  const download =
    overrides.download ?? vi.fn(async () => ({ data: null, error: null }));
  const handle = { upload, download };
  const from = vi.fn(() => handle);
  return { storage: { from } as unknown as ReportStorage, from, upload, download };
}

describe("storage", () => {
  it("storeReportPdf uploads to the private bucket at {shop}/{period}.pdf, upsert true", async () => {
    const { storage, from, upload } = mockStorage();
    const res = await storeReportPdf(SHOP, PERIOD, new Uint8Array([1, 2, 3]), { storage });

    expect(from).toHaveBeenCalledWith(REPORTS_BUCKET);
    const [path, body, opts] = upload.mock.calls[0];
    expect(path).toBe(`${SHOP}/${PERIOD}.pdf`);
    expect(body).toBeInstanceOf(Uint8Array);
    expect(opts).toEqual({ upsert: true, contentType: "application/pdf" });
    expect(res.path).toBe(`${SHOP}/${PERIOD}.pdf`);
  });

  it("storeReportNarrative uploads the JSON at {shop}/{period}.json", async () => {
    const { storage, upload } = mockStorage();
    await storeReportNarrative(SHOP, PERIOD, narrative, { storage });

    const [path, body, opts] = upload.mock.calls[0];
    expect(path).toBe(`${SHOP}/${PERIOD}.json`);
    expect(JSON.parse(body as string)).toEqual(narrative);
    expect(opts).toEqual({ upsert: true, contentType: "application/json" });
  });

  it("loadReportNarrative round-trips the stored JSON", async () => {
    const blob = new Blob([JSON.stringify(narrative)], { type: "application/json" });
    const { storage, download } = mockStorage({
      download: vi.fn(async () => ({ data: blob, error: null })),
    });
    const loaded = await loadReportNarrative(SHOP, PERIOD, { storage });
    expect(download).toHaveBeenCalledWith(`${SHOP}/${PERIOD}.json`);
    expect(loaded).toEqual(narrative);
  });

  it("loadReportNarrative returns null when the object is not found", async () => {
    const { storage } = mockStorage({
      download: vi.fn(async () => ({ data: null, error: { message: "Object not found" } })),
    });
    expect(await loadReportNarrative(SHOP, PERIOD, { storage })).toBeNull();
  });

  it("storeReportPdf throws on a real storage error", async () => {
    const { storage } = mockStorage({
      upload: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    });
    await expect(
      storeReportPdf(SHOP, PERIOD, new Uint8Array([1]), { storage })
    ).rejects.toThrow(/storeReportPdf failed: boom/);
  });
});
