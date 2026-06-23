import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { currentTemplateHash } from "@/lib/production/template-gate";

// PSG-217 / PSG-115b — the live-batch gate is enforced at /api/production/generate.
// This suite proves the ROUTE refuses an un-approved template (422, no rows
// written) and lets a released template through to the rest of the flow. The
// approval store + supabase service client are mocked; the template-gate logic
// (hash + eligibility) is the real module.

let gate: unknown = { ok: true, userId: "ops-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: async () => gate,
}));

// Approval lookup — swap `approvalRow` per test.
let approvalRow: Record<string, unknown> | null = null;
const getMock = vi.fn(async () => approvalRow);
vi.mock("@/lib/ops/template-approvals", () => ({
  supabaseApprovalStore: () => ({ get: getMock }),
}));

// Minimal supabase fake: company lookup returns "not found" so a request that
// PASSES the gate stops at 404 (proving the gate let it through) without needing
// to fake the whole generate pipeline.
const companySingle = vi.fn(async () => ({ data: null, error: { message: "not found" } }));
const fromMock = vi.fn(() => ({
  select: () => ({ eq: () => ({ single: companySingle }) }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: fromMock }),
}));

const { POST } = await import("@/app/api/production/generate/route");

const COMPANY = "11111111-2222-4333-8444-555555555555";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/production/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  gate = { ok: true, userId: "ops-1", access: {} };
  approvalRow = null;
  getMock.mockClear();
  fromMock.mockClear();
  companySingle.mockClear();
});

describe("POST /api/production/generate — template gate", () => {
  it("422 when the template has no approval (no batch created)", async () => {
    approvalRow = null;
    const res = await POST(req({ name: "Spring run", company_id: COMPANY, product: "warranty" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reason?: string; templateKey?: string };
    expect(body.reason).toBe("no_approval");
    expect(body.templateKey).toBe("warranty");
    // Gate fired before any DB work on companies/customers.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("422 when approved but not released (not_released)", async () => {
    approvalRow = { content_hash: currentTemplateHash("warranty"), status: "approved" };
    const res = await POST(req({ name: "Spring run", company_id: COMPANY, product: "warranty" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { reason?: string }).reason).toBe("not_released");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("422 when released against a stale hash (stale_hash)", async () => {
    approvalRow = { content_hash: "stale-hash", status: "released" };
    const res = await POST(req({ name: "Spring run", company_id: COMPANY, product: "warranty" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { reason?: string }).reason).toBe("stale_hash");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("passes the gate when released and matching (proceeds past the gate)", async () => {
    approvalRow = { content_hash: currentTemplateHash("warranty"), status: "released" };
    const res = await POST(req({ name: "Spring run", company_id: COMPANY, product: "warranty" }));
    // Gate passed → route continues and stops at the (faked) missing company.
    expect(res.status).toBe(404);
    expect(fromMock).toHaveBeenCalledWith("companies");
  });
});
