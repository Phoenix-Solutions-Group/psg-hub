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
    subscriptionStatus: "active",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Tedesco Auto Body",
    slug: "tedesco",
    tier: "performance",
    subscriptionStatus: "active",
  },
];

const users: ManagedUser[] = [
  {
    profileId: "11111111-1111-4111-8111-111111111111",
    displayName: "BSM Demo Admin",
    email: "demo-admin@psgweb.me",
    role: "psg_superadmin",
    memberships: [
      { shopId: shops[0].id, shopName: shops[0].name, role: "owner" },
      { shopId: shops[1].id, shopName: shops[1].name, role: "manager" },
    ],
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
    expect(html).toContain("Wallace Collision");
    expect(html).toContain("Tedesco Auto Body");
    expect(html).toContain("Owner");
    expect(html).toContain("Manager");
  });

  it("uses existing shops for assignment and tier edits", () => {
    const html = render();

    expect(html).toContain("Assign shop");
    expect(html).toContain("Wallace Collision");
    expect(html).toContain("Tedesco Auto Body");
    expect(html).toContain("Shop tier");
  });

  it("lets admins clear or set a selected shop tier", () => {
    const html = render();

    expect(html).toContain(">No subscription tier</option>");
    expect(html).toContain(">Essentials</option>");
    expect(html).toContain(">Growth</option>");
    expect(html).toContain(">Performance</option>");
  });
});
