import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(appDir, ".env.test.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = "https://hub.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-3035-live");
fs.mkdirSync(evidenceDir, { recursive: true });
const result = { checkedAt: new Date().toISOString(), baseUrl, target: "Danielle Brooks — Draft v1", checks: [] };

const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});

for (const viewport of [
  { name: "desktop", width: 1366, height: 768, hasTouch: false },
  { name: "short-touch", width: 1024, height: 520, hasTouch: true },
]) {
  const check = { viewport, signedIn: false, opened: false };
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.hasTouch,
    isMobile: viewport.hasTouch,
  });
  const page = await context.newPage();
  const mutationRequests = [];
  page.on("request", request => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutationRequests.push(request.url());
  });
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(env.DEMO_SHOP_EMAIL);
    await page.getByLabel("Password").fill(env.DEMO_SHOP_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
    check.signedIn = true;
    await page.goto(`${baseUrl}/dashboard/reviews`, { waitUntil: "networkidle" });
    const opener = page.locator("tbody tr").filter({ hasText: "Danielle Brooks" }).first()
      .getByRole("button", { name: "Draft v1", exact: true });
    await opener.focus();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Draft response" });
    await dialog.waitFor();
    check.opened = true;
    check.initialFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim());
    check.headingVisibleAtTop = await dialog.getByRole("heading", { name: "Draft response" }).isVisible();
    check.closeVisibleAtTop = await dialog.getByRole("button", { name: "Close" }).isVisible();
    check.bodyLocked = await page.evaluate(() => document.body.style.overflow === "hidden");
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-top.png`) });
    const scrollContainer = dialog;
    check.layout = await dialog.evaluate(el => ({
      dialog: { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom },
      parent: { scrollHeight: el.parentElement?.scrollHeight, clientHeight: el.parentElement?.clientHeight, overflowY: el.parentElement ? getComputedStyle(el.parentElement).overflowY : null },
      body: { scrollHeight: document.body.scrollHeight, clientHeight: document.body.clientHeight, overflowY: getComputedStyle(document.body).overflowY },
    }));
    await dialog.hover();
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(150);
    check.wheelScrollTop = await scrollContainer.evaluate(el => el.scrollTop);
    check.teamCommentsReachable = await dialog.getByRole("heading", { name: "Team comments" }).isVisible();
    check.addCommentReachable = await dialog.getByRole("button", { name: "Add comment", exact: true }).isVisible();
    await scrollContainer.evaluate(el => { el.scrollTop = 0; });
    if (viewport.hasTouch) {
      const session = await context.newCDPSession(page);
      const box = await dialog.boundingBox();
      const touchX = Math.round((box?.x ?? 0) + (box?.width ?? viewport.width) / 2);
      const touchBottom = Math.round((box?.y ?? 0) + Math.min((box?.height ?? viewport.height) - 50, 420));
      const touchTop = Math.round((box?.y ?? 0) + 70);
      for (let i = 0; i < 3; i += 1) {
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchBottom }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX, y: touchTop }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      await page.waitForTimeout(150);
      check.touchStyleBottomReached = await scrollContainer.evaluate(
        el => el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      );
      for (let i = 0; i < 3; i += 1) {
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchTop }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX, y: touchBottom }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      await page.waitForTimeout(150);
      check.touchStyleTopReturn = await scrollContainer.evaluate(el => el.scrollTop <= 2);
    } else {
      check.touchStyleBottomReached = true;
      check.touchStyleTopReturn = true;
    }
    let stayedInside = true;
    for (let i = 0; i < 24; i += 1) {
      await page.keyboard.press("Tab");
      stayedInside &&= await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    }
    check.tabStayedInside = stayedInside;
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-bottom.png`) });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    check.escapeClosed = true;
    check.focusReturnedToOpener = await opener.evaluate(el => document.activeElement === el);
    check.bodyScrollRestored = await page.evaluate(() => document.body.style.overflow !== "hidden");
    check.mutationRequests = mutationRequests.filter(url => !url.includes("/auth/v1/token"));
  } catch (error) {
    check.error = error instanceof Error ? error.message : String(error);
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-failure.png`) }).catch(() => {});
  } finally {
    result.checks.push(check);
    await context.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

const passed = result.checks.every(check => check.signedIn && check.opened && check.initialFocus === "Close" &&
  check.headingVisibleAtTop && check.closeVisibleAtTop && check.bodyLocked &&
  (check.layout.dialog.scrollHeight <= check.layout.dialog.clientHeight || check.wheelScrollTop > 0) &&
  check.teamCommentsReachable && check.addCommentReachable && check.touchStyleTopReturn &&
  check.touchStyleBottomReached && check.tabStayedInside && check.escapeClosed &&
  check.focusReturnedToOpener && check.bodyScrollRestored && check.mutationRequests.length === 0);
if (!passed) process.exitCode = 1;
