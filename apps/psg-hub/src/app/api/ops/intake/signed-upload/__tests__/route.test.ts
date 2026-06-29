import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- mocks ---------------------------------------------------------------
// requireSuperadmin is the auth gate (swap `gate` per-test). The service client's
// storage is stubbed so the REAL helper runs end-to-end (path validation + mint
// shape) without a live secret. recordAuditEvent is spied so we assert the mint is
// audited with the path only (never the token/URL).
let gate: unknown = { ok: true, userId: "super-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({ requireSuperadmin: async () => gate }));

const createSignedUploadUrl = vi.fn(async (path: string) => ({
  data: { signedUrl: `https://storage/upload/${path}?token=tok-123`, token: "tok-123", path },
  error: null as { message: string } | null,
}));
const storageFrom = vi.fn(() => ({ createSignedUploadUrl }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ storage: { from: storageFrom } }),
}));

type AuditEventArg = { actorProfileId: string; action: string; payload: Record<string, unknown> };
const auditMock = vi.fn<(e: AuditEventArg) => Promise<string>>(async () => "audit-1");
vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: (e: AuditEventArg) => auditMock(e),
}));

const { POST } = await import("@/app/api/ops/intake/signed-upload/route");

function post(body: unknown) {
  return new NextRequest("http://localhost/api/ops/intake/signed-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  companySlug: "collision-leaders",
  shopSlug: "shelton-collision",
  fileName: "ro-export-2026-06.csv",
};

beforeEach(() => {
  gate = { ok: true, userId: "super-1", access: {} };
  createSignedUploadUrl.mockClear();
  storageFrom.mockClear();
  auditMock.mockClear();
});

describe("POST /api/ops/intake/signed-upload — auth gating", () => {
  it("401 when unauthenticated; no mint, no audit", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await POST(post(VALID));
    expect(res.status).toBe(401);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("403 when not a superadmin; no mint, no audit", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const res = await POST(post(VALID));
    expect(res.status).toBe(403);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/intake/signed-upload — input validation", () => {
  it("400 on a non-JSON body", async () => {
    const req = new NextRequest("http://localhost/api/ops/intake/signed-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    { ...VALID, companySlug: "Bad Slug" },
    { ...VALID, shopSlug: ".." },
    { ...VALID, fileName: "../../etc/passwd" },
    { ...VALID, fileName: "nested/path.csv" },
    { companySlug: "collision-leaders", shopSlug: "shelton-collision" }, // missing fileName
  ])("400 on bad path input %j; no mint, no audit", async (body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/intake/signed-upload — happy path", () => {
  it("200 returns the signed-URL triple for the validated path", async () => {
    const res = await POST(post(VALID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      path: "collision-leaders/shelton-collision/ro-export-2026-06.csv",
      signedUrl:
        "https://storage/upload/collision-leaders/shelton-collision/ro-export-2026-06.csv?token=tok-123",
      token: "tok-123",
    });
    expect(storageFrom).toHaveBeenCalledWith("pilot-intake");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      "collision-leaders/shelton-collision/ro-export-2026-06.csv",
    );
  });

  it("audits the mint with the path only — never the token or signed URL", async () => {
    await POST(post(VALID));
    expect(auditMock).toHaveBeenCalledTimes(1);
    const event = auditMock.mock.calls[0][0];
    expect(event.actorProfileId).toBe("super-1");
    expect(event.action).toBe("intake.signed_upload.mint");
    expect(event.payload).toEqual({
      bucket: "pilot-intake",
      path: "collision-leaders/shelton-collision/ro-export-2026-06.csv",
    });
    // The secret never lands in the audit trail.
    expect(JSON.stringify(event)).not.toContain("tok-123");
    expect(JSON.stringify(event)).not.toContain("signedUrl");
  });
});
