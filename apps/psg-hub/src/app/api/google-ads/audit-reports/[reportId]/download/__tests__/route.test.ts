import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const membershipMaybeSingle = vi.fn();
const reportMaybeSingle = vi.fn();
const download = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingle }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: reportMaybeSingle }),
      }),
    }),
    storage: { from: () => ({ download }) },
  }),
}));

import { GET } from "@/app/api/google-ads/audit-reports/[reportId]/download/route";

const REPORT_ID = "22222222-2222-4222-8222-222222222222";
const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const STORAGE_PATH = `${SHOP_ID}/${REPORT_ID}.pdf`;

function call(reportId = REPORT_ID) {
  return GET(new Request("https://hub.psgweb.me/api/google-ads/audit-reports/x/download"), {
    params: Promise.resolve({ reportId }),
  });
}

beforeEach(() => {
  getUser.mockReset();
  membershipMaybeSingle.mockReset();
  reportMaybeSingle.mockReset();
  download.mockReset();
});

describe("GET Google Ads audit report download", () => {
  it("401 when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await call();

    expect(res.status).toBe(401);
  });

  it("404 when the report record is missing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    reportMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await call();

    expect(res.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("403 when the user is not a member of the report shop", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    reportMaybeSingle.mockResolvedValue({
      data: { shop_id: SHOP_ID, title: "Optimization Audit", storage_path: STORAGE_PATH },
      error: null,
    });
    membershipMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await call();

    expect(res.status).toBe(403);
    expect(download).not.toHaveBeenCalled();
  });

  it("200 streams a private PDF for a member of the report shop", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    reportMaybeSingle.mockResolvedValue({
      data: { shop_id: SHOP_ID, title: "Optimization Audit", storage_path: STORAGE_PATH },
      error: null,
    });
    membershipMaybeSingle.mockResolvedValue({ data: { role: "owner" }, error: null });
    const blob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
    download.mockResolvedValue({ data: blob, error: null });

    const res = await call();

    expect(res.status).toBe(200);
    expect(download).toHaveBeenCalledWith(STORAGE_PATH);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("400 on malformed report id", async () => {
    const res = await call("bad-id");
    expect(res.status).toBe(400);
  });
});
