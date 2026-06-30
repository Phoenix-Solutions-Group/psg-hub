import { describe, it, expect, vi } from "vitest";
import {
  bucketChannel,
  resolveChannelId,
  captureInboundLead,
  createPipedriveIntakeClient,
  ChannelOptionError,
  CHANNEL_KEY,
  UTM_KEYS,
  DEFAULT_PIPELINE_ID,
  DEFAULT_STAGE_ID,
  type ChannelOption,
  type PipedriveIntakeClient,
} from "../pipedrive-intake";
import { PipedriveError } from "../../pipedrive/client";

// Live enum (contract doc, PSG-483/488). Channel ids are illustrative-but-stable.
const OPTIONS: ChannelOption[] = [
  { id: 311, label: "Paid Search" },
  { id: 312, label: "Paid Social" },
  { id: 313, label: "Organic / SEO" },
  { id: 314, label: "Referral — Client" },
  { id: 315, label: "Referral — Partner" },
  { id: 319, label: "Outbound / Cold" },
  { id: 320, label: "Web Form (Direct)" },
  { id: 321, label: "Event / Trade" },
  { id: 322, label: "Existing Client — Expansion" },
  { id: 399, label: "Unknown (legacy)" },
];

describe("bucketChannel — UTM -> analyst Channel bucket (never blank)", () => {
  it("cpc + a search engine -> Paid Search", () => {
    expect(bucketChannel("google", "cpc")).toBe("Paid Search");
    expect(bucketChannel("bing", "ppc")).toBe("Paid Search");
    expect(bucketChannel("Google", "CPC")).toBe("Paid Search"); // case-insensitive
  });
  it("paid + a social network -> Paid Social", () => {
    expect(bucketChannel("facebook", "paid_social")).toBe("Paid Social");
    expect(bucketChannel("instagram", "cpc")).toBe("Paid Social"); // social source disambiguates
    expect(bucketChannel("linkedin", "paid")).toBe("Paid Social");
    expect(bucketChannel("anything", "paidsocial")).toBe("Paid Social"); // medium keyword
  });
  it("bare paid-search medium with no source still resolves to Paid Search", () => {
    expect(bucketChannel(null, "cpc")).toBe("Paid Search");
    expect(bucketChannel("", "sem")).toBe("Paid Search");
  });
  it("non-paid / unknown traffic defaults to Web Form (Direct)", () => {
    expect(bucketChannel("google", "organic")).toBe("Web Form (Direct)");
    expect(bucketChannel("newsletter", "email")).toBe("Web Form (Direct)");
    expect(bucketChannel(null, null)).toBe("Web Form (Direct)");
    expect(bucketChannel(undefined, undefined)).toBe("Web Form (Direct)");
    expect(bucketChannel("partner-site", "referral")).toBe("Web Form (Direct)");
  });
  it("ambiguous paid medium with unknown source stays Web Form (no mis-attribution)", () => {
    expect(bucketChannel("mystery", "display")).toBe("Web Form (Direct)");
    expect(bucketChannel(null, "paid")).toBe("Web Form (Direct)");
  });
});

describe("resolveChannelId — validates against the live enum (never junk)", () => {
  it("resolves a label (case-insensitive) to its option id", () => {
    expect(resolveChannelId("Web Form (Direct)", OPTIONS)).toBe(320);
    expect(resolveChannelId("paid search", OPTIONS)).toBe(311);
  });
  it("accepts a numeric option id that exists", () => {
    expect(resolveChannelId(319, OPTIONS)).toBe(319);
    expect(resolveChannelId("312", OPTIONS)).toBe(312);
  });
  it("rejects an unknown label", () => {
    expect(() => resolveChannelId("Telepathy", OPTIONS)).toThrow(ChannelOptionError);
  });
  it("rejects a numeric id that is not an option", () => {
    expect(() => resolveChannelId(99999, OPTIONS)).toThrow(ChannelOptionError);
  });
});

// ── a recording mock client ─────────────────────────────────────────────────────────
function makeClient(overrides: Partial<PipedriveIntakeClient> = {}) {
  const created: Record<string, unknown>[] = [];
  const dealsByTitle = new Map<string, { id: number }>();
  let nextDealId = 1000;
  let nextOrgId = 5000;
  let nextPersonId = 7000;

  const client: PipedriveIntakeClient = {
    getChannelOptions: vi.fn(async () => OPTIONS),
    findDealByTitle: vi.fn(async (title: string) => dealsByTitle.get(title) ?? null),
    findOrganizationByName: vi.fn(async () => null),
    createOrganization: vi.fn(async () => ({ id: nextOrgId++ })),
    findPerson: vi.fn(async () => null),
    createPerson: vi.fn(async () => ({ id: nextPersonId++ })),
    createDeal: vi.fn(async (body: Record<string, unknown>) => {
      created.push(body);
      const id = nextDealId++;
      dealsByTitle.set(String(body.title), { id });
      return { id };
    }),
    ...overrides,
  };
  return { client, created };
}

const FIXED_NOW = new Date("2026-06-30T15:00:00.000Z");

describe("captureInboundLead", () => {
  it("creates a deal in PSG Sales / New Lead with Channel + UTM fields stamped", async () => {
    const { client, created } = makeClient();
    const result = await captureInboundLead(
      client,
      {
        shopName: "Smith Auto Body",
        contactName: "Jane Smith",
        email: "jane@smithauto.com",
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "bsm-launch",
        utmContent: "hero-cta",
      },
      { now: FIXED_NOW },
    );

    expect(result).toEqual({
      dealId: 1000,
      idempotent: false,
      channel: "Paid Search",
    });
    expect(created).toHaveLength(1);
    const body = created[0];
    expect(body.title).toBe("Smith Auto Body — Inbound Web Lead — 2026-06-30");
    expect(body.pipeline_id).toBe(DEFAULT_PIPELINE_ID);
    expect(body.stage_id).toBe(DEFAULT_STAGE_ID);
    expect(body[CHANNEL_KEY]).toBe(311); // Paid Search option id (never blank)
    expect(body[UTM_KEYS.utm_source]).toBe("google");
    expect(body[UTM_KEYS.utm_medium]).toBe("cpc");
    expect(body[UTM_KEYS.utm_campaign]).toBe("bsm-launch");
    expect(body[UTM_KEYS.utm_content]).toBe("hero-cta");
    expect(body.org_id).toBe(5000);
    expect(body.person_id).toBe(7000);
  });

  it("defaults the Channel to Web Form (Direct) when there are no derivable UTMs — never blank", async () => {
    const { client, created } = makeClient();
    const result = await captureInboundLead(
      client,
      { shopName: "No-UTM Collision", email: "a@b.com" },
      { now: FIXED_NOW },
    );
    expect(result.channel).toBe("Web Form (Direct)");
    expect(created[0][CHANNEL_KEY]).toBe(320);
    // No UTMs present -> no UTM keys stamped.
    expect(created[0][UTM_KEYS.utm_source]).toBeUndefined();
  });

  it("honors an explicit Channel override (label) over the UTM bucket", async () => {
    const { client, created } = makeClient();
    await captureInboundLead(
      client,
      { shopName: "Referred Shop", email: "x@y.com", leadSourceChannel: "Referral — Partner" },
      { now: FIXED_NOW },
    );
    expect(created[0][CHANNEL_KEY]).toBe(315);
  });

  it("is idempotent: a double-submit (same shop, same day) yields one deal", async () => {
    const { client, created } = makeClient();
    const first = await captureInboundLead(
      client,
      { shopName: "Repeat Shop", email: "dup@shop.com", utmMedium: "cpc", utmSource: "google" },
      { now: FIXED_NOW },
    );
    const second = await captureInboundLead(
      client,
      { shopName: "Repeat Shop", email: "dup@shop.com", utmMedium: "cpc", utmSource: "google" },
      { now: FIXED_NOW },
    );
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.dealId).toBe(first.dealId);
    expect(created).toHaveLength(1); // only one create call ever fired
    expect(client.createDeal).toHaveBeenCalledTimes(1);
  });

  it("reuses a matched Org and Person instead of creating duplicates", async () => {
    const { client, created } = makeClient({
      findOrganizationByName: vi.fn(async () => ({ id: 4242 })),
      findPerson: vi.fn(async () => ({ id: 8484 })),
    });
    await captureInboundLead(
      client,
      { shopName: "Existing Shop", email: "known@shop.com" },
      { now: FIXED_NOW },
    );
    expect(client.createOrganization).not.toHaveBeenCalled();
    expect(client.createPerson).not.toHaveBeenCalled();
    expect(created[0].org_id).toBe(4242);
    expect(created[0].person_id).toBe(8484);
  });

  it("rejects (never writes) when the resolved Channel is not a live enum option", async () => {
    const { client, created } = makeClient({
      getChannelOptions: vi.fn(async () => OPTIONS.filter((o) => o.label !== "Web Form (Direct)")),
    });
    await expect(
      captureInboundLead(client, { shopName: "Orphan", email: "a@b.com" }, { now: FIXED_NOW }),
    ).rejects.toBeInstanceOf(ChannelOptionError);
    expect(created).toHaveLength(0);
  });

  it("requires a shop name", async () => {
    const { client } = makeClient();
    await expect(
      captureInboundLead(client, { shopName: "   ", email: "a@b.com" }),
    ).rejects.toThrow(/shopName/);
  });
});

describe("createPipedriveIntakeClient — token hygiene", () => {
  it("fails closed with no token, and the error carries no token material", () => {
    expect(() => createPipedriveIntakeClient({ apiKey: "" })).toThrow(PipedriveError);
    try {
      createPipedriveIntakeClient({ apiKey: "" });
    } catch (e) {
      expect((e as Error).message).not.toContain("api_token");
    }
  });

  it("never includes the token (or the token-bearing URL) in a transport error", async () => {
    const SECRET = "super-secret-admin-token";
    const fetchImpl = vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    const client = createPipedriveIntakeClient({ apiKey: SECRET, fetchImpl });
    try {
      await client.getChannelOptions();
      throw new Error("expected a PipedriveError");
    } catch (e) {
      expect(e).toBeInstanceOf(PipedriveError);
      expect((e as Error).message).not.toContain(SECRET);
      expect((e as Error).message).not.toContain("api_token");
    }
    // The token DID travel in the request URL (classic auth) but is never surfaced.
    const calledUrl = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(String(calledUrl)).toContain(`api_token=${SECRET}`);
  });

  // Route every mocked call by URL path so the transport mapping is exercised end-to-end.
  function routedFetch(routes: Record<string, unknown>) {
    const calls: string[] = [];
    const impl = vi.fn(async (input: string | URL) => {
      const u = new URL(String(input));
      calls.push(`${u.pathname}`);
      // longest matching suffix wins (so /deals/5 beats /deals)
      const key =
        Object.keys(routes)
          .filter((p) => u.pathname.includes(p))
          .sort((a, b) => b.length - a.length)[0] ?? "";
      return Response.json({ success: true, data: routes[key] ?? null });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("findDealByTitle dedupes via search + per-id pipeline/status check", async () => {
    const { impl } = routedFetch({
      "deals/search": { items: [{ item: { id: 42 } }] },
      "deals/42": { id: 42, title: "Acme — Inbound Web Lead — 2026-06-30", pipeline_id: 8, status: "open" },
    });
    const client = createPipedriveIntakeClient({ apiKey: "t", fetchImpl: impl });
    const hit = await client.findDealByTitle("Acme — Inbound Web Lead — 2026-06-30", 8);
    expect(hit).toEqual({ id: 42 });
  });

  it("findDealByTitle ignores a wrong-pipeline / deleted match", async () => {
    const { impl } = routedFetch({
      "deals/search": { items: [{ item: { id: 42 } }] },
      "deals/42": { id: 42, title: "X", pipeline_id: 9, status: "open" },
    });
    const client = createPipedriveIntakeClient({ apiKey: "t", fetchImpl: impl });
    expect(await client.findDealByTitle("X", 8)).toBeNull();
  });

  it("create* + find* map ids and POST bodies correctly", async () => {
    const posted: Record<string, unknown>[] = [];
    const impl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      if (init?.method === "POST") posted.push(JSON.parse(String(init.body)));
      if (u.pathname.includes("organizations/search")) {
        return Response.json({ success: true, data: { items: [{ item: { id: 7, name: "Acme" } }] } });
      }
      if (u.pathname.includes("persons/search")) {
        return Response.json({ success: true, data: { items: [] } });
      }
      if (u.pathname.includes("organizations")) return Response.json({ success: true, data: { id: 11 } });
      if (u.pathname.includes("persons")) return Response.json({ success: true, data: { id: 22 } });
      if (u.pathname.includes("deals")) return Response.json({ success: true, data: { id: 33 } });
      return Response.json({ success: true, data: null });
    }) as unknown as typeof fetch;
    const client = createPipedriveIntakeClient({ apiKey: "t", fetchImpl: impl });

    expect(await client.findOrganizationByName("Acme")).toEqual({ id: 7 });
    expect(await client.findPerson("nope@x.com")).toBeNull();
    expect(await client.createOrganization("Beta Body")).toEqual({ id: 11 });
    expect(await client.createPerson({ name: "Jo", email: "jo@x.com", phone: "555", orgId: 11 })).toEqual({ id: 22 });
    expect(await client.createDeal({ title: "T" })).toEqual({ id: 33 });

    const personBody = posted.find((b) => b.name === "Jo")!;
    expect(personBody.email).toEqual(["jo@x.com"]); // Pipedrive expects array-shaped contact fields
    expect(personBody.phone).toEqual(["555"]);
    expect(personBody.org_id).toBe(11);
  });

  it("surfaces success=false as a PipedriveError (no token leak)", async () => {
    const impl = vi.fn(async () => Response.json({ success: false })) as unknown as typeof fetch;
    const client = createPipedriveIntakeClient({ apiKey: "secret", fetchImpl: impl });
    await expect(client.createDeal({ title: "T" })).rejects.toBeInstanceOf(PipedriveError);
  });

  it("parses dealFields options into {id,label} from a mocked response", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        success: true,
        data: [
          {
            key: CHANNEL_KEY,
            options: [
              { id: 311, label: "Paid Search" },
              { id: 320, label: "Web Form (Direct)" },
              { id: 0, label: "" }, // filtered out (junk)
            ],
          },
          { key: "other", options: [{ id: 1, label: "ignore" }] },
        ],
      }),
    ) as unknown as typeof fetch;
    const client = createPipedriveIntakeClient({ apiKey: "t", fetchImpl });
    const opts = await client.getChannelOptions();
    expect(opts).toEqual([
      { id: 311, label: "Paid Search" },
      { id: 320, label: "Web Form (Direct)" },
    ]);
  });
});
