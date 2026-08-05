// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function changeField(field: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function findByLabel(container: HTMLElement, labelText: string) {
  const label = [...container.querySelectorAll<HTMLLabelElement>("label")].find((node) =>
    node.textContent?.includes(labelText)
  );
  const id = label?.getAttribute("for");
  const field = id ? container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`) : null;
  if (!field) throw new Error(`Missing field: ${labelText}`);
  return field;
}

function findButton(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) =>
    node.textContent?.includes(text)
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

describe("UserAccessManager", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

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

  it("adds a successfully invited user to the visible searchable list immediately", async () => {
    const invitedEmail = "qa-invite-check@example.org";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).toMatchObject({
        email: invitedEmail,
        role: "psg_superadmin",
        shopId: shops[0].id,
        shopRole: "manager",
      });
      return Response.json({
        user: {
          id: "99999999-9999-4999-8999-999999999999",
          email: invitedEmail,
          role: "psg_superadmin",
          shopId: shops[0].id,
          shopRole: "manager",
        },
      }, { status: 201 });
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root?.render(<UserAccessManager users={users} shops={shops} />);
    });

    changeField(findByLabel(container, "Email"), invitedEmail);
    changeField(findByLabel(container, "Global role"), "psg_superadmin");
    changeField(findByLabel(container, "Starting shop"), shops[0].id);
    await vi.waitFor(() => expect(container?.textContent).toContain("Shop role"));
    changeField(findByLabel(container, "Shop role"), "manager");
    findButton(container, "Send invite").click();

    await vi.waitFor(() => {
      expect(container?.textContent).toContain(invitedEmail);
      expect(container?.textContent).toContain("Superadmin");
      expect(container?.textContent).toContain("Wallace Collision");
      expect(container?.textContent).toContain("Manager");
    });
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Search users"]')?.value).toBe(invitedEmail);
  });
});
