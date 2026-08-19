import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getActiveShopContext = vi.fn();
let mockUser: { id: string } | null = { id: "user_1" };

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/shop/context", () => ({ getActiveShopContext }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockUser } })),
    },
  })),
}));

const InvoicesPage = (await import("@/app/dashboard/invoices/page")).default;

beforeEach(() => {
  redirect.mockClear();
  getActiveShopContext.mockReset();
  mockUser = { id: "user_1" };
  getActiveShopContext.mockResolvedValue({
    shops: [{ id: "riverside/shop" }],
    activeShopId: "riverside/shop",
  });
});

describe("InvoicesPage", () => {
  it("sends an authenticated customer to the existing shop-scoped invoices page", async () => {
    await expect(InvoicesPage()).rejects.toThrow(
      "REDIRECT:/dashboard/shop/riverside%2Fshop/invoices"
    );

    expect(getActiveShopContext).toHaveBeenCalledWith("user_1");
  });

  it("requires login before resolving a shop", async () => {
    mockUser = null;

    await expect(InvoicesPage()).rejects.toThrow("REDIRECT:/login");
    expect(getActiveShopContext).not.toHaveBeenCalled();
  });

  it("returns a customer without an active shop to the protected dashboard", async () => {
    getActiveShopContext.mockResolvedValue({ shops: [], activeShopId: null });

    await expect(InvoicesPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
