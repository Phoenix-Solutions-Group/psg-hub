import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, notFound, redirect } = vi.hoisted(() => ({
  getUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));

vi.mock("next/navigation", () => ({ notFound, redirect }));

import DemoReviewPreviewPage from "@/app/review-workspace/demo/[slug]/page";

describe("private demo review preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
  });

  it("renders the seeded Riverside draft for an authenticated customer", async () => {
    const html = renderToStaticMarkup(
      await DemoReviewPreviewPage({
        params: Promise.resolve({ slug: "riverside-august-reputation-post" }),
      }),
    );

    expect(html).toContain("Draft preview");
    expect(html).toContain("A repair you can feel confident about");
    expect(html.toLowerCase()).not.toContain("publish");
  });

  it("returns signed-out visitors to login before revealing preview content", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(
      DemoReviewPreviewPage({
        params: Promise.resolve({ slug: "riverside-august-reputation-post" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("does not expose unrecognized demo preview slugs", async () => {
    await expect(
      DemoReviewPreviewPage({ params: Promise.resolve({ slug: "unknown-preview" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
  });
});
