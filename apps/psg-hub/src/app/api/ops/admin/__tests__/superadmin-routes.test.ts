import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

type Gate =
  | { ok: true; userId: string; access: Record<string, unknown> }
  | { ok: false; response: NextResponse };

type DbError = { message: string; code?: string };
type DbResponse = { data?: unknown; error?: DbError | null };
type Operation = { table: string; op: string; payload?: unknown };

let gate: Gate = { ok: true, userId: "super-1", access: {} };
const auditEvents: Array<Record<string, unknown>> = [];
const operations: Operation[] = [];
const responses = new Map<string, DbResponse[]>();
const listUsersMock = vi.fn();
const inviteUserByEmailMock = vi.fn();

function key(table: string, op: string) {
  return `${table}:${op}`;
}

function queue(table: string, op: string, ...items: DbResponse[]) {
  responses.set(key(table, op), [...items]);
}

function next(table: string, op: string): DbResponse {
  const items = responses.get(key(table, op));
  return items?.shift() ?? { data: null, error: null };
}

class Query {
  private op: string | null = null;

  constructor(private readonly table: string) {}

  select() {
    this.op ??= "select";
    return this;
  }

  order() {
    return this;
  }

  eq() {
    return this;
  }

  insert(payload: unknown) {
    this.op = "insert";
    operations.push({ table: this.table, op: "insert", payload });
    return this;
  }

  update(payload: unknown) {
    this.op = "update";
    operations.push({ table: this.table, op: "update", payload });
    return this;
  }

  upsert(payload: unknown) {
    this.op = "upsert";
    operations.push({ table: this.table, op: "upsert", payload });
    return this;
  }

  delete() {
    this.op = "delete";
    operations.push({ table: this.table, op: "delete" });
    return this;
  }

  maybeSingle() {
    return Promise.resolve(next(this.table, "select"));
  }

  single() {
    return Promise.resolve(next(this.table, this.op ?? "select"));
  }

  then<TResult1 = DbResponse, TResult2 = never>(
    onfulfilled?: ((value: DbResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(next(this.table, this.op ?? "select")).then(onfulfilled, onrejected);
  }
}

const fromMock = vi.fn((table: string) => new Query(table));

vi.mock("@/lib/auth/ops-access", () => ({
  OPS_FUNCTIONS: ["manage_companies", "manage_reports", "manage_sysconfig", "manage_production"],
  requireSuperadmin: async () => gate,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: fromMock,
    auth: {
      admin: {
        listUsers: listUsersMock,
        inviteUserByEmail: inviteUserByEmailMock,
      },
    },
  }),
}));

vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: vi.fn(async (event: Record<string, unknown>) => {
    auditEvents.push(event);
    return "audit-1";
  }),
}));

const modulesRoute = await import("@/app/api/ops/modules/route");
const moduleRoute = await import("@/app/api/ops/modules/[id]/route");
const grantsRoute = await import("@/app/api/ops/modules/grants/route");
const securityProfilesRoute = await import("@/app/api/ops/security-profiles/route");
const securityProfileRoute = await import("@/app/api/ops/security-profiles/[id]/route");
const securityAssignmentsRoute = await import("@/app/api/ops/security-profiles/assignments/route");
const userInviteRoute = await import("@/app/api/ops/admin/users/invite/route");
const userRoleRoute = await import("@/app/api/ops/admin/users/[profileId]/role/route");
const userShopsRoute = await import("@/app/api/ops/admin/users/[profileId]/shops/route");
const shopTierRoute = await import("@/app/api/ops/admin/shops/[shopId]/tier/route");

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const MODULE_ID = "33333333-3333-4333-8333-333333333333";
const SECURITY_PROFILE_ID = "44444444-4444-4444-8444-444444444444";

function req(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

beforeEach(() => {
  gate = { ok: true, userId: "super-1", access: {} };
  auditEvents.length = 0;
  operations.length = 0;
  responses.clear();
  fromMock.mockClear();
  listUsersMock.mockReset();
  inviteUserByEmailMock.mockReset();
  listUsersMock.mockResolvedValue({ data: { users: [] }, error: null });
  inviteUserByEmailMock.mockResolvedValue({
    data: { user: { id: PROFILE_ID, email: "new@example.com" } },
    error: null,
  });
});

describe("superadmin-gated admin API routes", () => {
  it.each([
    ["modules", () => modulesRoute.GET()],
    ["security profiles", () => securityProfilesRoute.GET()],
    [
      "admin user invites",
      () =>
        userInviteRoute.POST(
          req("POST", "/api/ops/admin/users/invite", {
            email: "new@example.com",
            role: "customer",
          })
        ),
    ],
    [
      "admin users",
      () =>
        userRoleRoute.PATCH(
          req("PATCH", `/api/ops/admin/users/${PROFILE_ID}/role`, { role: "psg_internal" }),
          params({ profileId: PROFILE_ID })
        ),
    ],
    [
      "admin shops / tier edits",
      () =>
        shopTierRoute.PATCH(
          req("PATCH", `/api/ops/admin/shops/${SHOP_ID}/tier`, { tier: "growth" }),
          params({ shopId: SHOP_ID })
        ),
    ],
  ])("%s returns 401/403 before any database write", async (_name, callRoute) => {
    gate = { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    expect((await callRoute()).status).toBe(401);

    gate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    expect((await callRoute()).status).toBe(403);

    expect(operations).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });
});

describe("modules routes", () => {
  it("returns modules and grants for a superadmin", async () => {
    queue("modules", "select", { data: [{ id: MODULE_ID, slug: "reports" }], error: null });
    queue("module_access_grants", "select", { data: [{ id: "grant-1" }], error: null });

    const res = await modulesRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      modules: [{ id: MODULE_ID, slug: "reports" }],
      grants: [{ id: "grant-1" }],
    });
  });

  it("audits module create, update, delete, and role grant changes", async () => {
    queue("modules", "insert", {
      data: {
        id: MODULE_ID,
        slug: "reports",
        display_name: "Reports",
        audience: "ops",
        min_tier_slug: null,
        default_visibility: "visible",
      },
      error: null,
    });
    expect(
      (
        await modulesRoute.POST(
          req("POST", "/api/ops/modules", {
            slug: "Reports",
            displayName: "Reports",
            audience: "ops",
            defaultVisibility: "visible",
          })
        )
      ).status
    ).toBe(201);

    queue("modules", "select", {
      data: {
        id: MODULE_ID,
        slug: "reports",
        display_name: "Reports",
        audience: "ops",
        min_tier_slug: null,
        default_visibility: "visible",
      },
      error: null,
    });
    queue("modules", "update", {
      data: {
        id: MODULE_ID,
        slug: "reports",
        display_name: "Ops Reports",
        audience: "ops",
        min_tier_slug: null,
        default_visibility: "visible",
      },
      error: null,
    });
    expect(
      (
        await moduleRoute.PATCH(
          req("PATCH", `/api/ops/modules/${MODULE_ID}`, { displayName: "Ops Reports" }),
          params({ id: MODULE_ID })
        )
      ).status
    ).toBe(200);

    queue("modules", "select", { data: { id: MODULE_ID, slug: "reports" }, error: null });
    queue("module_access_grants", "delete", { data: null, error: null });
    queue("module_access_grants", "insert", {
      data: { id: "grant-1", module_id: MODULE_ID, role: "psg_internal", effect: "allow" },
      error: null,
    });
    expect(
      (
        await grantsRoute.POST(
          req("POST", "/api/ops/modules/grants", {
            moduleId: MODULE_ID,
            role: "psg_internal",
            effect: "allow",
          })
        )
      ).status
    ).toBe(201);

    queue("modules", "select", { data: { id: MODULE_ID, slug: "reports" }, error: null });
    queue("modules", "delete", { data: null, error: null });
    expect(
      (await moduleRoute.DELETE(req("DELETE", `/api/ops/modules/${MODULE_ID}`), params({ id: MODULE_ID }))).status
    ).toBe(200);

    expect(auditEvents.map((event) => event.action)).toEqual([
      "module.visibility.set",
      "module.visibility.set",
      "module_access.grant",
      "module.visibility.set",
    ]);
  });
});

describe("security profile routes", () => {
  it("returns security profiles for a superadmin", async () => {
    queue("security_profile_defs", "select", {
      data: [{ id: SECURITY_PROFILE_ID, name: "Ops Manager" }],
      error: null,
    });

    const res = await securityProfilesRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      profiles: [{ id: SECURITY_PROFILE_ID, name: "Ops Manager" }],
    });
  });

  it("audits security profile create, update, delete, assign, and unassign", async () => {
    queue("security_profile_defs", "insert", {
      data: { id: SECURITY_PROFILE_ID, name: "Ops Manager", is_builtin: false, functions_jsonb: {} },
      error: null,
    });
    expect(
      (
        await securityProfilesRoute.POST(
          req("POST", "/api/ops/security-profiles", {
            name: "Ops Manager",
            functions: ["manage_companies"],
          })
        )
      ).status
    ).toBe(201);

    queue("security_profile_defs", "select", {
      data: { id: SECURITY_PROFILE_ID, name: "Ops Manager", is_builtin: false, functions_jsonb: {} },
      error: null,
    });
    queue("security_profile_defs", "update", {
      data: { id: SECURITY_PROFILE_ID, name: "Senior Ops", is_builtin: false, functions_jsonb: {} },
      error: null,
    });
    expect(
      (
        await securityProfileRoute.PATCH(
          req("PATCH", `/api/ops/security-profiles/${SECURITY_PROFILE_ID}`, { name: "Senior Ops" }),
          params({ id: SECURITY_PROFILE_ID })
        )
      ).status
    ).toBe(200);

    queue("app_user_roles", "select", { data: { role: "psg_internal" }, error: null });
    queue("security_profile_defs", "select", { data: { id: SECURITY_PROFILE_ID, name: "Senior Ops" }, error: null });
    queue("user_security_profile_assignments", "upsert", { data: null, error: null });
    expect(
      (
        await securityAssignmentsRoute.POST(
          req("POST", "/api/ops/security-profiles/assignments", {
            profileId: PROFILE_ID,
            securityProfileId: SECURITY_PROFILE_ID,
          })
        )
      ).status
    ).toBe(201);

    queue("user_security_profile_assignments", "delete", { data: null, error: null });
    expect(
      (
        await securityAssignmentsRoute.DELETE(
          req("DELETE", "/api/ops/security-profiles/assignments", {
            profileId: PROFILE_ID,
            securityProfileId: SECURITY_PROFILE_ID,
          })
        )
      ).status
    ).toBe(200);

    queue("security_profile_defs", "select", {
      data: { id: SECURITY_PROFILE_ID, name: "Senior Ops", is_builtin: false },
      error: null,
    });
    queue("security_profile_defs", "delete", { data: null, error: null });
    expect(
      (
        await securityProfileRoute.DELETE(
          req("DELETE", `/api/ops/security-profiles/${SECURITY_PROFILE_ID}`),
          params({ id: SECURITY_PROFILE_ID })
        )
      ).status
    ).toBe(200);

    expect(auditEvents.map((event) => event.action)).toEqual([
      "security_profile_def.create",
      "security_profile_def.update",
      "security_profile.assign",
      "security_profile.unassign",
      "security_profile_def.delete",
    ]);
  });
});

describe("admin user routes", () => {
  it("invites a new user, grants starting access, and audits the invite", async () => {
    queue("shops", "select", { data: { id: SHOP_ID, name: "Wallace", slug: "wallace" }, error: null });
    queue("profiles", "upsert", { data: null, error: null });
    queue("app_user_roles", "upsert", { data: null, error: null });
    queue("shop_users", "upsert", { data: null, error: null });

    const res = await userInviteRoute.POST(
      req("POST", "/api/ops/admin/users/invite", {
        email: "NEW@Example.com",
        role: "psg_internal",
        shopId: SHOP_ID,
        shopRole: "manager",
      })
    );

    expect(res.status).toBe(201);
    expect(inviteUserByEmailMock).toHaveBeenCalledWith(
      "new@example.com",
      expect.objectContaining({ data: { display_name: "new@example.com" } })
    );
    expect(operations).toEqual([
      {
        table: "profiles",
        op: "upsert",
        payload: { id: PROFILE_ID, display_name: "new@example.com" },
      },
      {
        table: "app_user_roles",
        op: "upsert",
        payload: { profile_id: PROFILE_ID, role: "psg_internal" },
      },
      {
        table: "shop_users",
        op: "upsert",
        payload: { user_id: PROFILE_ID, shop_id: SHOP_ID, role: "manager" },
      },
    ]);
    expect(auditEvents).toEqual([
      expect.objectContaining({
        actorProfileId: "super-1",
        action: "user.invite",
        targetProfileId: PROFILE_ID,
        targetShopId: SHOP_ID,
        payload: expect.objectContaining({
          email: "new@example.com",
          role: "psg_internal",
          shopRole: "manager",
          shopName: "Wallace",
        }),
      }),
    ]);
  });

  it("rejects invalid invite payloads before sending an invite", async () => {
    const res = await userInviteRoute.POST(
      req("POST", "/api/ops/admin/users/invite", {
        email: "",
        role: "admin",
        shopRole: "owner",
      })
    );

    expect(res.status).toBe(422);
    expect(inviteUserByEmailMock).not.toHaveBeenCalled();
    expect(operations).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });

  it("rejects duplicate invite emails before mutating access", async () => {
    listUsersMock.mockResolvedValue({
      data: { users: [{ id: "existing-user", email: "new@example.com" }] },
      error: null,
    });

    const res = await userInviteRoute.POST(
      req("POST", "/api/ops/admin/users/invite", {
        email: "new@example.com",
        role: "customer",
      })
    );

    expect(res.status).toBe(409);
    expect(inviteUserByEmailMock).not.toHaveBeenCalled();
    expect(operations).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });

  it("audits granting and removing superadmin explicitly", async () => {
    queue("profiles", "select", { data: { id: PROFILE_ID, display_name: "Ada" }, error: null });
    queue("app_user_roles", "select", { data: { role: "psg_internal" }, error: null });
    queue("app_user_roles", "upsert", {
      data: { profile_id: PROFILE_ID, role: "psg_superadmin" },
      error: null,
    });
    expect(
      (
        await userRoleRoute.PATCH(
          req("PATCH", `/api/ops/admin/users/${PROFILE_ID}/role`, { role: "psg_superadmin" }),
          params({ profileId: PROFILE_ID })
        )
      ).status
    ).toBe(200);

    queue("profiles", "select", { data: { id: PROFILE_ID, display_name: "Ada" }, error: null });
    queue("app_user_roles", "select", { data: { role: "psg_superadmin" }, error: null });
    queue("app_user_roles", "upsert", {
      data: { profile_id: PROFILE_ID, role: "psg_internal" },
      error: null,
    });
    expect(
      (
        await userRoleRoute.PATCH(
          req("PATCH", `/api/ops/admin/users/${PROFILE_ID}/role`, { role: "psg_internal" }),
          params({ profileId: PROFILE_ID })
        )
      ).status
    ).toBe(200);

    expect(auditEvents.map((event) => event.action)).toEqual([
      "superadmin.add",
      "superadmin.remove",
    ]);
  });

  it("audits shop assignment and removal", async () => {
    queue("profiles", "select", { data: { id: PROFILE_ID, display_name: "Ada" }, error: null });
    queue("shops", "select", { data: { id: SHOP_ID, name: "Wallace", slug: "wallace" }, error: null });
    queue("shop_users", "select", { data: null, error: null });
    queue("shop_users", "upsert", {
      data: { user_id: PROFILE_ID, shop_id: SHOP_ID, role: "manager" },
      error: null,
    });
    expect(
      (
        await userShopsRoute.POST(
          req("POST", `/api/ops/admin/users/${PROFILE_ID}/shops`, {
            shopId: SHOP_ID,
            role: "manager",
          }),
          params({ profileId: PROFILE_ID })
        )
      ).status
    ).toBe(201);

    queue("shops", "select", { data: { id: SHOP_ID, name: "Wallace", slug: "wallace" }, error: null });
    queue("shop_users", "select", { data: { role: "manager" }, error: null });
    queue("shop_users", "delete", { data: null, error: null });
    expect(
      (
        await userShopsRoute.DELETE(
          req("DELETE", `/api/ops/admin/users/${PROFILE_ID}/shops`, { shopId: SHOP_ID }),
          params({ profileId: PROFILE_ID })
        )
      ).status
    ).toBe(200);

    expect(auditEvents.map((event) => event.action)).toEqual(["shop.assign", "shop.unassign"]);
  });
});

describe("admin shop tier route", () => {
  it("updates a shop tier and writes an audit event", async () => {
    queue("shops", "select", { data: { id: SHOP_ID, name: "Wallace", slug: "wallace" }, error: null });
    queue("subscriptions", "select", {
      data: { id: "sub-1", tier: "essentials", status: "active" },
      error: null,
    });
    queue("subscriptions", "update", {
      data: { shop_id: SHOP_ID, tier: "growth", status: "active" },
      error: null,
    });

    const res = await shopTierRoute.PATCH(
      req("PATCH", `/api/ops/admin/shops/${SHOP_ID}/tier`, { tier: "growth" }),
      params({ shopId: SHOP_ID })
    );

    expect(res.status).toBe(200);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      actorProfileId: "super-1",
      action: "tier.change",
      targetShopId: SHOP_ID,
    });
  });
});
