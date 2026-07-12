import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  enrollNurturePath,
  enrollStalledPipedriveDeals,
  exitNurtureEnrollments,
  stalledDealCutoff,
  type NurtureSupabase,
} from "../enrollment";

type Result = { data: unknown; error: { message: string } | null };

class FakeQuery implements PromiseLike<Result> {
  columns?: string;
  filters: Array<[string, string, unknown]> = [];
  updates: Record<string, unknown> | null = null;
  upsertRow: Record<string, unknown> | null = null;
  onConflict?: string;

  constructor(
    private readonly table: string,
    private readonly calls: FakeCalls,
    private readonly data: unknown = null
  ) {}

  select(columns?: string): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push(["eq", column, value]);
    return this;
  }

  in(column: string, value: unknown[]): this {
    this.filters.push(["in", column, value]);
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push(["lte", column, value]);
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push(["is", column, value]);
    return this;
  }

  or(filters: string): this {
    this.filters.push(["or", "filters", filters]);
    return this;
  }

  single(): this {
    return this;
  }

  upsert(row: Record<string, unknown>, options?: { onConflict?: string }): this {
    this.upsertRow = row;
    this.onConflict = options?.onConflict;
    this.calls.upserts.push({ table: this.table, row, onConflict: this.onConflict });
    return this;
  }

  update(row: Record<string, unknown>): this {
    this.updates = row;
    this.calls.updates.push({ table: this.table, row, query: this });
    return this;
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.data, error: null }).then(onfulfilled, onrejected);
  }
}

interface FakeCalls {
  upserts: Array<{ table: string; row: Record<string, unknown>; onConflict?: string }>;
  updates: Array<{ table: string; row: Record<string, unknown>; query: FakeQuery }>;
  queries: FakeQuery[];
}

function fakeDb(dataByTable: Record<string, unknown> = {}) {
  const calls: FakeCalls = { upserts: [], updates: [], queries: [] };
  const service: NurtureSupabase = {
    from(table: string) {
      const q = new FakeQuery(table, calls, dataByTable[table] ?? null);
      calls.queries.push(q);
      return q as never;
    },
  };
  return { service, calls };
}

beforeEach(() => {
  vi.stubEnv("SOLICITATION_HASH_SALT", "unit-test-salt");
});

describe("nurture enrollment writer", () => {
  it("selects the Wave 1 path from the trigger and upserts on path plus trigger_ref", async () => {
    const { service, calls } = fakeDb();

    const result = await enrollNurturePath(service, {
      trigger: "web_lead",
      triggerRef: "ai_visibility_check:em_hash",
      contact: {
        email: "Owner@Shop.com ",
        phone: "(555) 867-5309",
        smsConsent: true,
      },
      enrolledAt: "2026-07-12T00:00:00.000Z",
    });

    expect(result.path).toBe("hot_inbound");
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]).toMatchObject({
      table: "nurture_enrollments",
      onConflict: "path,trigger_ref",
    });
    expect(calls.upserts[0]!.row).toMatchObject({
      path: "hot_inbound",
      status: "active",
      trigger_ref: "ai_visibility_check:em_hash",
      enrolled_at: "2026-07-12T00:00:00.000Z",
      exit_reason: null,
      exited_at: null,
    });
    expect(calls.upserts[0]!.row.email_contact_hash).toMatch(/^em_/);
    expect(calls.upserts[0]!.row.sms_contact_hash).toMatch(/^ph_/);
    expect(calls.upserts[0]!.row.contact_jsonb).toEqual({
      firstName: null,
      shopName: null,
      email: "Owner@Shop.com ",
      phone: "(555) 867-5309",
    });
    expect(calls.upserts[0]!.row.template_jsonb).toEqual({});
  });

  it("uses one idempotency key for repeated stalled-deal enrollment", async () => {
    const { service, calls } = fakeDb();

    await enrollNurturePath(service, {
      trigger: "deal_stale_14_days",
      triggerRef: "pipedrive:deal:42:stale_14_days",
      contact: {},
      pipedriveDealId: 42,
    });
    await enrollNurturePath(service, {
      trigger: "deal_stale_14_days",
      triggerRef: "pipedrive:deal:42:stale_14_days",
      contact: {},
      pipedriveDealId: 42,
    });

    expect(calls.upserts.map((x) => x.row.path)).toEqual(["stalled_deal", "stalled_deal"]);
    expect(calls.upserts.every((x) => x.onConflict === "path,trigger_ref")).toBe(true);
    expect(new Set(calls.upserts.map((x) => x.row.trigger_ref))).toEqual(
      new Set(["pipedrive:deal:42:stale_14_days"])
    );
  });

  it("finds open Pipedrive deals with no movement for 14 days and enrolls them", async () => {
    const { service, calls } = fakeDb({
      pipedrive_deals: [
        { deal_id: 42, person_id: 7, org_id: 9, last_activity_date: "2026-06-20" },
      ],
    });

    const result = await enrollStalledPipedriveDeals(service, {
      now: new Date("2026-07-12T00:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, enrolled: 1 });
    const lookup = calls.queries.find((q) => q.columns?.includes("deal_id"));
    expect(lookup?.filters).toContainEqual(["eq", "status", "open"]);
    expect(lookup?.filters).toContainEqual([
      "or",
      "filters",
      "last_activity_date.lte.2026-06-28,last_activity_date.is.null",
    ]);
    expect(calls.upserts[0]!.row).toMatchObject({
      path: "stalled_deal",
      pipedrive_deal_id: 42,
      pipedrive_person_id: 7,
      pipedrive_org_id: 9,
      trigger_ref: "pipedrive:deal:42:stale_14_days",
    });
  });

  it("hydrates stalled Pipedrive deals from the person contact before hashing", async () => {
    const { service, calls } = fakeDb({
      pipedrive_deals: [
        { deal_id: 42, person_id: 7, org_id: 9, last_activity_date: "2026-06-20" },
      ],
    });
    const pipedriveClient = {
      fetchPersonContact: vi.fn(async () => ({
        firstName: "Pat",
        email: "Pat@shop.com",
        phone: "(555) 867-5309",
      })),
    };

    const result = await enrollStalledPipedriveDeals(service, {
      now: new Date("2026-07-12T00:00:00.000Z"),
      pipedriveClient,
    });

    expect(result).toEqual({ scanned: 1, enrolled: 1 });
    expect(pipedriveClient.fetchPersonContact).toHaveBeenCalledWith(7);
    expect(calls.upserts[0]!.row.email_contact_hash).toMatch(/^em_/);
    expect(calls.upserts[0]!.row.sms_contact_hash).toMatch(/^ph_/);
    expect(calls.upserts[0]!.row.contact_jsonb).toEqual({
      firstName: "Pat",
      shopName: null,
      email: "Pat@shop.com",
      phone: "(555) 867-5309",
    });
  });

  it("keeps a Pipedrive enrollment safely no-contact when the person has no usable detail", async () => {
    const { service, calls } = fakeDb();

    await enrollNurturePath(service, {
      trigger: "deal_won",
      triggerRef: "pipedrive:deal:42:won",
      contact: {},
      pipedriveDealId: 42,
      pipedrivePersonId: 7,
      pipedriveClient: {
        fetchPersonContact: vi.fn(async () => ({
          firstName: "Pat",
          email: null,
          phone: null,
        })),
      },
    });

    expect(calls.upserts[0]!.row).toMatchObject({
      path: "onboarding_retention",
      pipedrive_deal_id: 42,
      email_contact_hash: null,
      sms_contact_hash: null,
      contact_jsonb: {
        firstName: "Pat",
        shopName: null,
        email: null,
        phone: null,
      },
    });
  });

  it("models exit and suppression inputs as active-enrollment exits", async () => {
    const { service, calls } = fakeDb();

    await exitNurtureEnrollments(service, {
      reason: "unsubscribed",
      email: "owner@shop.com",
      exitedAt: "2026-07-12T01:00:00.000Z",
    });

    expect(calls.updates[0]).toMatchObject({
      table: "nurture_enrollments",
      row: {
        status: "exited",
        exit_reason: "unsubscribed",
        exited_at: "2026-07-12T01:00:00.000Z",
      },
    });
    expect(calls.updates[0]!.query.filters).toContainEqual(["eq", "status", "active"]);
    expect(calls.updates[0]!.query.filters.some((f) => f[0] === "or")).toBe(true);
  });

  it("computes a stable 14-day stale cutoff date", () => {
    expect(stalledDealCutoff(new Date("2026-07-12T03:00:00.000Z"))).toBe("2026-06-28");
  });
});
