import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked supabase clients (server SSR + service). Set per-test via the holders.
const getUser = vi.fn();
const maybeSingle = vi.fn();
const download = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ download }) },
  }),
}));

import { GET } from "@/app/api/reports/[shopId]/[period]/download/route";

const SHOP = "11111111-1111-1111-1111-111111111111";
const PERIOD = "2026-05";

function call(shopId = SHOP, period = PERIOD) {
  return GET(new Request("https://hub.psgweb.me/api/reports/x/y/download"), {
    params: Promise.resolve({ shopId, period }),
  });
}

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
  download.mockReset();
});

describe("GET report download", () => {
  it("401 when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("403 when the user is not a member of the shop", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    maybeSingle.mockResolvedValue({ data: null }); // no membership row
    const res = await call();
    expect(res.status).toBe(403);
    expect(download).not.toHaveBeenCalled();
  });

  it("200 streams the PDF for a member", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    maybeSingle.mockResolvedValue({ data: { role: "owner" } });
    const blob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
    download.mockResolvedValue({ data: blob, error: null });

    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("404 when the object is missing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    maybeSingle.mockResolvedValue({ data: { role: "owner" } });
    download.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("400 on a malformed shopId or period", async () => {
    const res = await call("not-a-uuid", "2026-5");
    expect(res.status).toBe(400);
  });
});
