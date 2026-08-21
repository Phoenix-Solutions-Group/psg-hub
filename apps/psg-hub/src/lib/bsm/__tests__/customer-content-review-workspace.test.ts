import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({
        data: {
          id: "77777777-7777-4777-8777-777777777777",
          shop_id: "11111111-1111-4111-8111-111111111111",
          project_id: "22222222-2222-4222-8222-222222222222",
        },
        error: null,
      }),
    }),
  }),
}));

import { getBsmCustomerReviewItem, requestBsmContentRestore } from "@/lib/bsm/customer-content-review";

describe("legacy content review boundary", () => {
  it("rejects Review Workspace items before legacy view or restore operations", async () => {
    const itemId = "77777777-7777-4777-8777-777777777777";
    const userId = "33333333-3333-4333-8333-333333333333";

    await expect(getBsmCustomerReviewItem({} as never, itemId, userId)).rejects.toMatchObject({ status: 404 });
    await expect(requestBsmContentRestore(
      {} as never,
      itemId,
      userId,
      "88888888-8888-4888-8888-888888888888",
      "Restore this version",
    )).rejects.toMatchObject({ status: 404 });
  });
});
