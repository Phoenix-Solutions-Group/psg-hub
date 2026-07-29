import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  UserAccessManager,
  type ManagedShop,
  type ManagedUser,
} from "@/components/ops/user-access-manager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const shops: ManagedShop[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Wallace Collision",
    slug: "wallace",
    tier: "growth",
    tierLabel: "Growth",
    subscriptionStatus: "active",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Tedesco Auto Body",
    slug: "tedesco",
    tier: "performance",
    tierLabel: "Performance",
    subscriptionStatus: "active",
  },
];

const users: ManagedUser[] = [
  {
    profileId: "11111111-1111-4111-8111-111111111111",
    displayName: "BSM Demo Admin",
    email: "demo-admin@psgweb.me",
    bannedUntil: null,
    isDeleted: false,
    isSuspended: false,
    role: "psg_superadmin",
    memberships: [
      { shopId: shops[0].id, shopName: shops[0].name, role: "owner" },
      { shopId: shops[1].id, shopName: shops[1].name, role: "manager" },
    ],
  },
  {
    profileId: "44444444-4444-4444-8444-444444444444",
    displayName: "Deleted Board User",
    email: "deleted-board-user@psgweb.me",
    bannedUntil: null,
    isDeleted: true,
    isSuspended: false,
    role: "customer",
    memberships: [{ shopId: shops[0].id, shopName: shops[0].name, role: "viewer" }],
  },
];

function render() {
  return renderToStaticMarkup(<UserAccessManager users={users} shops={shops} />);
}

describe("UserAccessManager", () => {
  it("shows invited/demo admins and their multiple shop assignments", () => {
    const html = render();

    expect(html).toContain("BSM Demo Admin");
    expect(html).toContain("demo-admin@psgweb.me");
    expect(html).toContain("Active");
    expect(html).toContain("Wallace Collision");
    expect(html).toContain("Tedesco Auto Body");
    expect(html).toContain("Owner");
    expect(html).toContain("Manager");
  });

  it("hides soft-deleted users from the board-facing access list", () => {
    const html = render();

    expect(html).not.toContain("Deleted Board User");
    expect(html).not.toContain("deleted-board-user@psgweb.me");
    expect(html).not.toContain("Deleted");
  });

  it("uses existing shops for assignment and points admins to Companies for new shops", () => {
    const html = render();

    expect(html).toContain("Add shop access");
    expect(html).toContain("Wallace Collision - Growth");
    expect(html).toContain("Tedesco Auto Body - Performance");
    expect(html).toContain("One login can have access to multiple shops");
    expect(html).toContain("href=\"/ops/companies\"");
  });

  it("shows tier labels separately from shop names", () => {
    const html = render();

    expect(html).toContain("Shop to update");
    expect(html).toContain("Tier for selected shop");
    expect(html).toContain("Current tier: Growth");
    expect(html).toContain(">No subscription tier</option>");
    expect(html).toContain(">Growth</option>");
    expect(html).toContain(">Performance</option>");
  });
});
