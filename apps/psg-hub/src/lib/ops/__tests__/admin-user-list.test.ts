import { describe, expect, it } from "vitest";
import { emailFromInviteAuditPayload, listAllAdminRows } from "@/lib/ops/admin-user-list";

function pagedRows(total: number) {
  const rows = Array.from({ length: total }, (_value, index) => ({ id: index + 1 }));
  const calls: Array<[number, number]> = [];

  return {
    calls,
    buildQuery() {
      return {
        async range(from: number, to: number) {
          calls.push([from, to]);
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
    },
  };
}

describe("listAllAdminRows", () => {
  it("paginates superadmin user-list table reads past the default Supabase cap", async () => {
    const db = pagedRows(1001);

    const rows = await listAllAdminRows(db.buildQuery);

    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)).toEqual({ id: 1001 });
    expect(db.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("throws on database errors instead of returning a partial user list", async () => {
    await expect(
      listAllAdminRows(() => ({
        async range() {
          return { data: null, error: { message: "permission denied" } };
        },
      }))
    ).rejects.toThrow("permission denied");
  });
});

describe("emailFromInviteAuditPayload", () => {
  it("normalizes the invite email stored in Access Audit payloads", () => {
    expect(emailFromInviteAuditPayload({ email: " New.User@Example.ORG " })).toBe(
      "new.user@example.org"
    );
  });

  it("ignores missing or invalid Access Audit payload emails", () => {
    expect(emailFromInviteAuditPayload(null)).toBeNull();
    expect(emailFromInviteAuditPayload({ email: "not-an-email" })).toBeNull();
    expect(emailFromInviteAuditPayload({ email: 123 })).toBeNull();
  });
});
