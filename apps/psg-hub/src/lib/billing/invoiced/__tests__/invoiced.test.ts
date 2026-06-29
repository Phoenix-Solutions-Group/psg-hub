import { describe, it, expect, vi } from "vitest";
import {
  KEY_ENV_CANDIDATES,
  InvoicedConfigError,
  loadInvoicedConfig,
} from "../config";
import {
  extractAccount,
  pingInvoiced,
  type FetchLike,
} from "../client";

// ── config ────────────────────────────────────────────────────────────────────

describe("loadInvoicedConfig", () => {
  it("resolves the key from the first matching candidate and reports the NAME, not the value", () => {
    const cfg = loadInvoicedConfig({ INVOICED_API_KEY: "sk_secret" });
    expect(cfg.apiKey).toBe("sk_secret");
    expect(cfg.keySource).toBe("INVOICED_API_KEY");
    // keySource must never be the secret itself.
    expect(cfg.keySource).not.toContain("sk_secret");
  });

  it("falls back through the candidate list in order", () => {
    const cfg = loadInvoicedConfig({ INVOICED_SECRET_KEY: "abc" });
    expect(cfg.keySource).toBe("INVOICED_SECRET_KEY");
    // earlier-listed candidates win when both are present
    const cfg2 = loadInvoicedConfig({
      INVOICED_SECRET_KEY: "abc",
      INVOICED_API_KEY: "first",
    });
    expect(cfg2.keySource).toBe(KEY_ENV_CANDIDATES[0]);
    expect(cfg2.apiKey).toBe("first");
  });

  it("defaults to the sandbox base URL and only goes live on explicit INVOICED_ENV=live", () => {
    expect(loadInvoicedConfig({ INVOICED_API_KEY: "k" }).environment).toBe("sandbox");
    expect(loadInvoicedConfig({ INVOICED_API_KEY: "k" }).baseUrl).toContain(
      "api.sandbox.invoiced.com",
    );
    const live = loadInvoicedConfig({ INVOICED_API_KEY: "k", INVOICED_ENV: "live" });
    expect(live.environment).toBe("live");
    expect(live.baseUrl).toBe("https://api.invoiced.com");
    // anything other than "live" stays sandbox (fail-safe toward no-spend)
    expect(
      loadInvoicedConfig({ INVOICED_API_KEY: "k", INVOICED_ENV: "prod" }).environment,
    ).toBe("sandbox");
  });

  it("throws InvoicedConfigError naming the vars it checked when no key is set", () => {
    expect(() => loadInvoicedConfig({})).toThrow(InvoicedConfigError);
    try {
      loadInvoicedConfig({});
    } catch (e) {
      expect((e as Error).message).toContain("INVOICED_API_KEY");
    }
  });

  it("treats whitespace-only values as unset", () => {
    expect(() =>
      loadInvoicedConfig({ INVOICED_API_KEY: "   " }),
    ).toThrow(InvoicedConfigError);
  });
});

// ── account extraction ──────────────────────────────────────────────────────────

const noHeaders = { get: () => null };

describe("extractAccount", () => {
  it("prefers the X-Account-Context header", () => {
    const acct = extractAccount(
      { get: (n) => (n === "X-Account-Context" ? "acct_42" : null) },
      [{ id: 7, name: "Ignore Me" }],
    );
    expect(acct).toEqual({ id: "acct_42", name: null, source: "header:X-Account-Context" });
  });

  it("falls back to the first customer record", () => {
    const acct = extractAccount(noHeaders, [{ id: 7, name: "Riverside Collision" }]);
    expect(acct).toEqual({ id: "7", name: "Riverside Collision", source: "body:customers[0]" });
  });

  it("reads name/company from a top-level object body", () => {
    expect(extractAccount(noHeaders, { company: "PSG Sandbox" })).toEqual({
      id: null,
      name: "PSG Sandbox",
      source: "body:object",
    });
  });

  it("returns null when nothing identifying is present (still reachable)", () => {
    expect(extractAccount(noHeaders, [])).toBeNull();
    expect(extractAccount(noHeaders, null)).toBeNull();
  });
});

// ── pingInvoiced ─────────────────────────────────────────────────────────────────

function mockFetch(
  response: Partial<Awaited<ReturnType<FetchLike>>> & { status: number; ok: boolean },
): { fn: FetchLike; calls: { url: string; headers: Record<string, string> }[] } {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers ?? { get: () => null },
      json: response.json ?? (async () => []),
      text: response.text ?? (async () => ""),
    };
  };
  return { fn, calls };
}

const sandboxCfg = {
  apiKey: "sk_test_abc",
  baseUrl: "https://api.sandbox.invoiced.com",
  environment: "sandbox" as const,
  keySource: "INVOICED_API_KEY",
};

describe("pingInvoiced", () => {
  it("green: reports reachable + keySource + account on a 200, and sends Basic auth (key as username, empty password)", async () => {
    const { fn, calls } = mockFetch({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, name: "PSG Sandbox Co" }],
    });
    const result = await pingInvoiced(fn, sandboxCfg);

    expect(result.reachable).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.environment).toBe("sandbox");
    expect(result.keySource).toBe("INVOICED_API_KEY");
    expect(result.account?.name).toBe("PSG Sandbox Co");
    expect(result.error).toBeUndefined();

    // hits the cheap read-only probe against the sandbox base URL
    expect(calls[0].url).toBe("https://api.sandbox.invoiced.com/customers?per_page=1");
    // Basic auth = base64("sk_test_abc:") — key as username, empty password
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("sk_test_abc:").toString("base64")}`,
    );
  });

  it("red on 401: surfaces a credential-rejected message and reachable:false (no throw)", async () => {
    const { fn } = mockFetch({ ok: false, status: 401, text: async () => "unauthorized" });
    const result = await pingInvoiced(fn, sandboxCfg);
    expect(result.reachable).toBe(false);
    expect(result.httpStatus).toBe(401);
    expect(result.error).toMatch(/rejected the key/i);
  });

  it("red on missing key: returns a clean config error naming the vars, never throwing", async () => {
    const { fn } = mockFetch({ ok: true, status: 200 });
    // configOverride omitted → real loader runs against the live process env with
    // every candidate var cleared, so we exercise the InvoicedConfigError path.
    const saved = new Map<string, string | undefined>();
    for (const name of KEY_ENV_CANDIDATES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    try {
      const result = await pingInvoiced(fn);
      expect(result.reachable).toBe(false);
      expect(result.error).toContain("INVOICED_API_KEY");
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("red on network throw: retried then reported, never leaking the key", async () => {
    const err = new Error("ECONNREFUSED 1.2.3.4");
    const fn = vi.fn(async () => {
      throw err;
    }) as unknown as FetchLike;
    const result = await pingInvoiced(fn, sandboxCfg);
    expect(result.reachable).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
    // withRetry attempts more than once on a transport error
    expect((fn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
    // the secret never appears in the surfaced result
    expect(JSON.stringify(result)).not.toContain("sk_test_abc");
  });
});
