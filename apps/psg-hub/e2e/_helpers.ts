import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SHOTS_DIR } from "./fixtures";
import path from "node:path";

/**
 * WCAG 2.0/2.1 AA scan. Fails the test on any serious/critical violation;
 * lower-impact ones are logged + attached for the SUMMARY (AC-3).
 */
export async function checkA11y(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );
  const lower = results.violations.filter(
    (v) => v.impact !== "serious" && v.impact !== "critical"
  );

  if (lower.length) {
    console.log(
      `[a11y:${label}] non-blocking: ${lower
        .map((v) => `${v.id}(${v.impact})`)
        .join(", ")}`
    );
  }
  await test
    .info()
    .attach(`axe-${label}`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });

  expect(
    blocking,
    `${label}: serious/critical a11y violations -> ${blocking
      .map((v) => v.id)
      .join(", ")}`
  ).toEqual([]);
}

/** Desktop (1280) + mobile (375) full-page screenshots for the visual brand pass. */
export async function shoot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(SHOTS_DIR, `${name}-desktop.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(SHOTS_DIR, `${name}-mobile.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
}
