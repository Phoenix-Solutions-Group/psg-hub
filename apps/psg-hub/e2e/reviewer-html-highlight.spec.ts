import { expect, test } from "@playwright/test";

test("reviewer can highlight text in an uploaded HTML proof", async ({ page }, testInfo) => {
  const comments: Array<Record<string, unknown>> = [];
  const document = {
    itemId: "11111111-1111-4111-8111-111111111111",
    versionId: "22222222-2222-4222-8222-222222222222",
    title: "Uploaded HTML",
    note: "Review the collision repair email.",
    processingStatus: "ready",
    sectionTitle: "Email proof",
    originalFilename: "tedesco-ablast.html",
    contentType: "text/html",
    previewUrl: null,
    generatedPagePath: null,
    proofUrl: "/api/bsm/review-workspace/file?proof=html",
    proofContent: null,
  };

  await page.route("**/api/bsm/review-workspace/verify", async (route) => {
    await route.fulfill({ json: { session: { sessionHash: "test-session" } } });
  });
  await page.route("**/api/bsm/review-workspace/session", async (route) => {
    await route.fulfill({
      json: {
        workspace: {
          project: { id: "project", title: "Tedesco email review", description: null, status: "in_review" },
          round: { id: "round", status: "active" },
          reviewer: { email: "reviewer@e2e.test", submittedAt: null, readOnly: false },
          documents: [document],
          comments,
          decisions: [],
        },
      },
    });
  });
  await page.route("**/api/bsm/review-workspace/file?proof=html", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><p>Tedesco collision repair experts make every step clear.</p></body></html>",
    });
  });
  let savedPayload: Record<string, unknown> | null = null;
  await page.route("**/api/bsm/review-workspace/comments", async (route) => {
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    comments.push({
      id: "comment",
      reviewItemId: document.itemId,
      versionId: document.versionId,
      body: savedPayload.body,
      commentKind: "highlight",
      pinNumber: 1,
      draftStatus: "draft",
      viewport: "desktop",
      xRatio: null,
      yRatio: null,
      selection: savedPayload.selection,
    });
    await route.fulfill({ json: { comment: comments[0] } });
  });

  await page.goto("/review-workspace?invite=test-invite");
  await page.getByLabel("One-time code").fill("123456");
  await page.getByRole("button", { name: "Open review" }).click();

  const highlightButton = page.getByRole("button", { name: "Highlight text" });
  await expect(highlightButton).toBeEnabled();
  await highlightButton.click();

  const proofText = page.frameLocator('iframe[title="Uploaded HTML proof"]').getByText(
    "Tedesco collision repair experts make every step clear.",
  );
  await proofText.selectText();
  await proofText.dispatchEvent("mouseup");
  await expect(page.getByText("Highlighted: “Tedesco collision repair experts make every step clear.”")).toBeVisible();

  await page.getByLabel("Private comment").fill("Please make this sentence more specific.");
  await page.getByRole("button", { name: "Save private comment" }).click();

  expect(savedPayload).toMatchObject({
    anchorKind: "highlight",
    selection: {
      kind: "text",
      text: "Tedesco collision repair experts make every step clear.",
    },
  });
  await expect(page.getByText("Please make this sentence more specific.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("reviewer-html-highlight.png"), fullPage: true });
});
