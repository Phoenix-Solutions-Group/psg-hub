import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOpsFn = vi.fn();
const upload = vi.fn();
const insert = vi.fn();
const audit = vi.fn();

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: (fn: string) => requireOpsFn(fn),
}));

vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: (event: Record<string, unknown>) => audit(event),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ upload }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => insert(row),
    }),
  }),
}));

import { POST } from "@/app/api/ops/google-ads/audit-reports/route";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "99999999-9999-4999-8999-999999999999";
const PDF_BASE64 = Buffer.from("%PDF-1.4\nbody").toString("base64");

function request(body: Record<string, unknown>) {
  return new Request("https://hub.psgweb.me/api/ops/google-ads/audit-reports", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireOpsFn.mockReset();
  upload.mockReset();
  insert.mockReset();
  audit.mockReset();
  requireOpsFn.mockResolvedValue({ ok: true, userId: ACTOR_ID, access: { role: "psg_internal" } });
  upload.mockResolvedValue({ data: {}, error: null });
  insert.mockImplementation((row: Record<string, unknown>) => ({
    select: () => ({
      single: async () => ({
        data: {
          id: row.id,
          shop_id: row.shop_id,
          title: row.title,
          period_month: row.period_month,
          storage_path: row.storage_path,
          published_at: "2026-07-17T00:00:00.000Z",
        },
        error: null,
      }),
    }),
  }));
  audit.mockResolvedValue("audit-1");
});

describe("POST Google Ads audit report publish", () => {
  it("requires the reports ops capability", async () => {
    await POST(request({}));
    expect(requireOpsFn).toHaveBeenCalledWith("manage_reports");
  });

  it("publishes a shop-scoped PDF, stores metadata, and records audit", async () => {
    const res = await POST(
      request({
        shopId: SHOP_ID,
        title: "July Optimization Audit",
        periodMonth: "2026-07",
        pdfBase64: PDF_BASE64,
        originalFilename: "audit.pdf",
        metadata: { reviewed: true, source: "human_review" },
      })
    );

    expect(res.status).toBe(201);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.shop_id).toBe(SHOP_ID);
    expect(row.title).toBe("July Optimization Audit");
    expect(row.period_month).toBe("2026-07");
    expect(row.original_filename).toBe("audit.pdf");
    expect(row.published_by_profile_id).toBe(ACTOR_ID);
    expect(row.metadata_jsonb).toEqual({ reviewed: true, source: "human_review" });
    expect(row.storage_path).toMatch(new RegExp(`^${SHOP_ID}/[0-9a-f-]{36}\\.pdf$`));
    expect(upload).toHaveBeenCalledWith(row.storage_path, expect.any(Uint8Array), {
      upsert: false,
      contentType: "application/pdf",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorProfileId: ACTOR_ID,
        action: "google_ads.audit_report.publish",
        targetShopId: SHOP_ID,
      })
    );
  });

  it("400 when the report body is not a PDF", async () => {
    const res = await POST(
      request({
        shopId: SHOP_ID,
        title: "Not a PDF",
        pdfBase64: Buffer.from("not-pdf").toString("base64"),
      })
    );

    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("400 when a supplied period is malformed", async () => {
    const res = await POST(
      request({
        shopId: SHOP_ID,
        title: "Audit",
        periodMonth: "2026-7",
        pdfBase64: PDF_BASE64,
      })
    );

    expect(res.status).toBe(400);
  });
});
