import { describe, it, expect, vi } from "vitest";
import {
  loadPipedriveConfig,
  normalizeCompanyDomain,
  presentPipedriveEnvKeys,
  PipedriveConfigError,
  PIPEDRIVE_TOKEN_ENV,
  PIPEDRIVE_DOMAIN_ENV,
} from "@/lib/crm/pipedrive/config";
import {
  pingPipedrive,
  PipedriveApiError,
  type PipedriveHttpGet,
  type PipedriveHttpResponse,
} from "@/lib/crm/pipedrive/client";

// ── helpers ─────────────────────────────────────────────────────────────────────
function okJson(body: unknown): PipedriveHttpResponse {
  return { ok: true, status: 200, json: async () => body };
}
function errJson(status: number): PipedriveHttpResponse {
  return { ok: false, status, json: async () => ({ error: "nope" }) };
}

const CONFIG = {
  apiToken: "tok_secret_value",
  companyDomain: "acme",
  baseUrl: "https://acme.pipedrive.com/api/v1",
};

const ME = {
  success: true,
  data: {
    id: 42,
    name: "Nick Schoolcraft",
    email: "nick@phoenixsolutionsgroup.net",
    company_id: 7,
    company_name: "Phoenix Solutions Group",
    company_domain: "acme",
  },
};

// ── config loader ─────────────────────────────────────────────────────────────────
describe("loadPipedriveConfig", () => {
  it("reads the canonical token + domain env names and builds the base URL", () => {
    const cfg = loadPipedriveConfig({
      [PIPEDRIVE_TOKEN_ENV]: "tok_abc",
      [PIPEDRIVE_DOMAIN_ENV]: "acme",
    });
    expect(cfg.apiToken).toBe("tok_abc");
    expect(cfg.companyDomain).toBe("acme");
    expect(cfg.baseUrl).toBe("https://acme.pipedrive.com/api/v1");
  });

  it("accepts alias var names when the canonical ones are unset", () => {
    const cfg = loadPipedriveConfig({
      PIPEDRIVE_TOKEN: "tok_alias",
      PIPEDRIVE_DOMAIN: "beta",
    });
    expect(cfg.apiToken).toBe("tok_alias");
    expect(cfg.companyDomain).toBe("beta");
  });

  it("trims whitespace and normalizes a full-host domain to its subdomain", () => {
    const cfg = loadPipedriveConfig({
      [PIPEDRIVE_TOKEN_ENV]: "  tok_padded  ",
      [PIPEDRIVE_DOMAIN_ENV]: " https://Acme.pipedrive.com/ ",
    });
    expect(cfg.apiToken).toBe("tok_padded");
    expect(cfg.companyDomain).toBe("acme");
    expect(cfg.baseUrl).toBe("https://acme.pipedrive.com/api/v1");
  });

  it("throws PipedriveConfigError listing candidate names when token is missing", () => {
    expect(() =>
      loadPipedriveConfig({ [PIPEDRIVE_DOMAIN_ENV]: "acme" }),
    ).toThrow(PipedriveConfigError);
    try {
      loadPipedriveConfig({ [PIPEDRIVE_DOMAIN_ENV]: "acme" });
    } catch (e) {
      expect(e).toBeInstanceOf(PipedriveConfigError);
      expect((e as PipedriveConfigError).missing).toContain(
        PIPEDRIVE_TOKEN_ENV,
      );
      // never leaks any value — only names
      expect((e as Error).message).not.toContain("acme");
    }
  });

  it("throws when domain is missing", () => {
    expect(() => loadPipedriveConfig({ [PIPEDRIVE_TOKEN_ENV]: "tok" })).toThrow(
      PipedriveConfigError,
    );
  });
});

describe("normalizeCompanyDomain", () => {
  it.each([
    ["acme", "acme"],
    ["acme.pipedrive.com", "acme"],
    ["https://acme.pipedrive.com", "acme"],
    ["http://acme.pipedrive.com/deals", "acme"],
    ["ACME", "acme"],
    ["", null],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeCompanyDomain(input)).toBe(expected);
  });
});

describe("presentPipedriveEnvKeys", () => {
  it("returns only the NAMES of PIPEDRIVE_* keys, sorted, never values", () => {
    const keys = presentPipedriveEnvKeys({
      PIPEDRIVE_COMPANY_DOMAIN: "acme",
      PIPEDRIVE_API_TOKEN: "tok_secret",
      OTHER: "x",
    });
    expect(keys).toEqual(["PIPEDRIVE_API_TOKEN", "PIPEDRIVE_COMPANY_DOMAIN"]);
    expect(keys.join()).not.toContain("tok_secret");
  });
});

// ── pingPipedrive ─────────────────────────────────────────────────────────────────
describe("pingPipedrive", () => {
  it("calls GET /users/me and surfaces the authenticated user + company", async () => {
    const httpGet = vi.fn<PipedriveHttpGet>(async (url) => {
      if (url.includes("/users/me")) return okJson(ME);
      return okJson({
        success: true,
        data: [{ id: 1 }],
        additional_data: { pagination: { total_count: 128 } },
      });
    });

    const ping = await pingPipedrive({ config: CONFIG, httpGet });

    expect(ping.reachable).toBe(true);
    expect(ping.user.name).toBe("Nick Schoolcraft");
    expect(ping.user.companyName).toBe("Phoenix Solutions Group");
    expect(ping.dealCount).toBe(128);

    // /users/me requested against the right host with the token as api_token query
    const meUrl = httpGet.mock.calls.find(([u]) => u.includes("/users/me"))![0];
    expect(meUrl).toContain("https://acme.pipedrive.com/api/v1/users/me");
    expect(meUrl).toContain("api_token=tok_secret_value");
  });

  it("still reports reachable when the deals count lookup fails", async () => {
    const httpGet = vi.fn<PipedriveHttpGet>(async (url) => {
      if (url.includes("/users/me")) return okJson(ME);
      return errJson(500); // deals endpoint flakes
    });

    const ping = await pingPipedrive({ config: CONFIG, httpGet });
    expect(ping.reachable).toBe(true);
    expect(ping.dealCount).toBeNull();
  });

  it("throws PipedriveApiError (secret-free) when /users/me is unauthorized", async () => {
    const httpGet = vi.fn<PipedriveHttpGet>(async () => errJson(401));
    await expect(
      pingPipedrive({ config: CONFIG, httpGet }),
    ).rejects.toMatchObject({ name: "PipedriveApiError", status: 401 });

    try {
      await pingPipedrive({ config: CONFIG, httpGet });
    } catch (e) {
      expect(e).toBeInstanceOf(PipedriveApiError);
      // the path is named, the api_token value is NOT in the message
      expect((e as Error).message).toContain("/users/me");
      expect((e as Error).message).not.toContain("tok_secret_value");
    }
  });
});
