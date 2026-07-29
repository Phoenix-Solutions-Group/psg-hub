import { expect, test } from "@playwright/test";
import { BSM_DEMO_USER, MULTI, OWNER } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

test.describe("focused BSM customer walkthrough", () => {
  test.use({ storageState: OWNER.statePath });

  test("customer can sign in and see the customer navigation", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Invoices" })).toBeVisible();
  });

  test("analytics is visible and useful", async ({ page }) => {
    await page.goto("/dashboard/analytics");
    await expect(page.getByRole("heading", { name: OWNER.shopName })).toBeVisible();
    await expect(page.getByText("Organic traffic").first()).toBeVisible();
    await expect(page.getByText(/Last synced/)).toBeVisible();
    await shoot(page, "focused-bsm-analytics");
  });

  test("Google Ads setup state is visible", async ({ page }) => {
    await page.goto("/dashboard/ads");
    await expect(page.getByRole("heading", { name: "Ads", exact: true })).toBeVisible();
    await shoot(page, "focused-bsm-ads");
    await expect(page.getByRole("heading", { name: "Google Ads" })).toBeVisible();
    await expect(page.getByText("No Google Ads account linked yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Link Google Ads" })).toBeVisible();
  });

  test("billing path is visible", async ({ page }) => {
    await page.goto("/dashboard/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("Manage your subscription and billing.")).toBeVisible();
    await expect(page.getByText("Essentials")).toBeVisible();
    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
    await expect(page.getByText("Performance")).toBeVisible();
    await shoot(page, "focused-bsm-billing");
  });

  test("invoice path is visible from the customer navigation", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Invoices" }).click();
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByText("View and pay your PSG invoices.")).toBeVisible();
    await expect(page.getByText("No invoices yet.")).toBeVisible();
    await shoot(page, "focused-bsm-invoices");
  });

  test("agent approval queue shows review-before-publish behavior", async ({
    page,
  }) => {
    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(
      page.getByText("Review agent-proposed actions before they go live.")
    ).toBeVisible();
    await expect(page.getByText("Nothing waiting for review.")).toBeVisible();
    await shoot(page, "focused-bsm-approvals");
  });

  test("customer can complete the BSM content approval loop", async ({ page }) => {
    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("heading", { name: "Content Review" })).toBeVisible();
    await page.getByRole("link", { name: /E2E BSM homepage approval/ }).click();

    await expect(page.getByRole("heading", { name: "E2E BSM homepage approval" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review content" })).toBeVisible();
    await expect(page.getByText("Homepage proof v2").first()).toBeVisible();

    await page.getByLabel("Comment").fill("The phone number and offer are correct.");
    await page.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByText("The phone number and offer are correct.")).toBeVisible();

    await page.getByLabel("Decision note").fill("Please tighten the headline.");
    await page.getByRole("button", { name: "Request updates" }).click();
    await expect(page.getByText("Request Updates")).toBeVisible();

    await page.getByLabel("Decision note").fill("Approved for launch.");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approve").first()).toBeVisible();

    await page.getByLabel("Decision note").fill("Declining duplicate test copy.");
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("Decline").first()).toBeVisible();

    await page.getByLabel("Restore request").fill("Restore the prior homepage proof for comparison.");
    await page.getByRole("button", { name: "Request restore" }).click();
    await expect(page.getByText("Restore the prior homepage proof for comparison.")).toBeVisible();

    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("heading", { name: "Approved Content Archive" })).toBeVisible();
    await expect(page.getByText("E2E BSM homepage approval")).toBeVisible();
  });

  test("customer cannot open another shop's BSM content approval", async ({ page }) => {
    const response = await page.goto(`/dashboard/approvals/content/${MULTI.bsmReviewItemId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  });

  test("customer can add one phone photo to a Content Approver reply", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/dashboard/approvals/content/${BSM_DEMO_USER.bsmReviewItemId}`);
    await expect(page.getByRole("heading", { name: "E2E BSM homepage approval" })).toBeVisible();

    const commentInput = page.getByLabel("Comment");
    const photoInput = page.locator("#bsm-comment-photo");
    const selectedPhoto = page.getByTestId("bsm-comment-photo-selection");
    const commentsSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Comments" }),
    });
    const addButton = page.getByRole("button", { name: "Add comment" });

    await commentInput.fill("Non-photo browser rejection");
    await photoInput.setInputFiles({
      name: "not-a-photo.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a photo"),
    });
    await expect(selectedPhoto.getByText("not-a-photo.txt")).toBeVisible();
    await addButton.click();
    await expect(page.getByText("Only JPG, PNG, or WebP photos can be attached.")).toBeVisible();
    await expect(page.getByText("Non-photo browser rejection").first()).not.toBeVisible();

    await page.getByRole("button", { name: "Remove photo" }).click();
    await commentInput.fill("Oversize photo browser rejection");
    await photoInput.setInputFiles({
      name: "oversize-photo.png",
      mimeType: "image/png",
      buffer: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(8 * 1024 * 1024),
      ]),
    });
    await addButton.click();
    await expect(page.getByText("The photo is too large. Attach one photo under 8 MB.")).toBeVisible();
    await expect(page.getByText("Oversize photo browser rejection").first()).not.toBeVisible();

    const twoPhotoResult = await page.evaluate(async (reviewItemId) => {
      const body = new FormData();
      body.set("body", "Two photo browser rejection");
      body.append(
        "photo",
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "first-photo.jpg", { type: "image/jpeg" }),
      );
      body.append(
        "photo",
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "second-photo.png", {
          type: "image/png",
        }),
      );
      const response = await fetch(`/api/bsm/content-approvals/${reviewItemId}/comments`, {
        method: "POST",
        body,
      });
      return { status: response.status, json: await response.json() };
    }, BSM_DEMO_USER.bsmReviewItemId);
    expect(twoPhotoResult).toEqual({
      status: 400,
      json: { error: "Attach only one photo to this reply." },
    });
    await page.reload();
    await expect(page.getByText("Two photo browser rejection").first()).not.toBeVisible();

    await commentInput.fill("Phone photo clarification reply");
    await photoInput.setInputFiles({
      name: "first-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
    });
    await expect(selectedPhoto.getByText("first-photo.png")).toBeVisible();
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(selectedPhoto).not.toBeVisible();

    await photoInput.setInputFiles({
      name: "candidate-photo.webp",
      mimeType: "image/webp",
      buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x0c, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
    });
    await expect(selectedPhoto.getByText("candidate-photo.webp")).toBeVisible();
    await photoInput.setInputFiles({
      name: "replacement-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]),
    });
    await expect(selectedPhoto.getByText("replacement-photo.png")).toBeVisible();
    await expect(selectedPhoto.getByText("candidate-photo.webp")).not.toBeVisible();

    await addButton.click();
    const submittedComment = commentsSection.locator("div").filter({
      hasText: "Phone photo clarification reply",
    }).last();
    await expect(submittedComment).toBeVisible();
    await expect(submittedComment.getByText("replacement-photo.png")).toBeVisible();
    await expect(submittedComment.getByText("1 KB")).toBeVisible();
    await expect(submittedComment.getByText("Photo passed upload screening")).toBeVisible();
    await shoot(page, "focused-bsm-content-approval-phone-photo-reply");
  });

  for (const route of [
    { path: "/dashboard/analytics", label: "focused-bsm-analytics" },
    { path: "/dashboard/ads", label: "focused-bsm-ads" },
    { path: "/dashboard/billing", label: "focused-bsm-billing" },
    { path: "/dashboard/approvals", label: "focused-bsm-approvals" },
  ]) {
    test(`${route.label} has no serious accessibility violations`, async ({
      page,
    }) => {
      await page.goto(route.path);
      await checkA11y(page, route.label);
    });
  }
});
