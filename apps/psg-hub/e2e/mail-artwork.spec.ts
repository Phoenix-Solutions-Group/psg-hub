import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { OPS_STAFF, OWNER } from "./fixtures";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe("mail artwork editor access", () => {
  test.use({ storageState: OWNER.statePath });

  test("customer user cannot access the PSG-only editor", async ({ page }) => {
    const response = await page.goto("/ops/production/artwork");

    expect(response?.status(), "non-staff users should receive a not-found response").toBe(404);
    await expect(page.getByRole("heading", { name: "Mail artwork editor" })).toHaveCount(0);

    const apiResponse = await page.request.get("/api/ops/production/artwork");
    expect(apiResponse.status(), "non-staff users should not read saved artwork drafts").toBe(403);
  });
});

test.describe("mail artwork editor", () => {
  test.use({ storageState: OPS_STAFF.statePath });

  test("staff can create, validate, save, refresh, and reload a postcard draft", async ({ page }) => {
    const draftName = `E2E Artwork ${Date.now()}`;

    await page.goto("/ops/production/artwork");
    await expect(page.getByRole("heading", { name: "Mail artwork editor" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Mail Artwork" })).toBeVisible();
    await page.getByLabel("Canvas size").selectOption("4x6");
    await page.getByLabel("Design name").fill(draftName);

    await page.locator("#logo-upload").setInputFiles({
      name: "psg-e2e-logo.png",
      mimeType: "image/png",
      buffer: createPng(1_000, 400, [16, 84, 147, 255]),
    });
    await expect(page.getByText("Logo uploaded.")).toBeVisible();

    await page.locator("#base-upload").setInputFiles({
      name: "psg-e2e-base.png",
      mimeType: "image/png",
      buffer: createPng(1_500, 1_000, [241, 245, 249, 255]),
    });
    await expect(page.getByText("Base uploaded.")).toBeVisible();

    await page.getByRole("button", { name: "Add text" }).click();
    await expect(page.getByText(/^Text /)).toBeVisible();
    await page.getByLabel("Text").fill("E2E front headline");
    await page.locator("#selected-font").selectOption("Georgia");

    await page.getByRole("button", { name: "Add shape" }).click();
    await expect(page.getByText(/^Shape /)).toBeVisible();
    await page.getByLabel("X (in)").fill("3");
    await page.getByLabel("Y (in)").fill("2");

    await page.getByRole("button", { name: "Add image" }).click();
    await expect(page.getByText(/^Image /)).toBeVisible();
    await page.getByLabel("X (in)").fill("0.3");
    await page.getByLabel("Y (in)").fill("2");
    await page.getByLabel("Width (in)").fill("1");
    await page.getByLabel("Height (in)").fill("1");
    await page.getByLabel("Rotation (deg)").fill("15");

    await page.getByTitle("Bring forward").first().click();
    await page.getByTitle("Send backward").first().click();

    await page.getByRole("button", { name: /E2E front headline/ }).click();
    await page.getByAltText("Layer element").click({ modifiers: ["Shift"] });
    await expect(page.getByText("Select one layer to edit details.")).toBeVisible();

    await page.getByLabel("Snap to quarter-inch").uncheck();
    await page.getByLabel("Snap to quarter-inch").check();

    for (const label of [
      "Show address/IMB zone",
      "Show return zone",
      "Show indicia zone",
      "Show clear zone",
    ]) {
      await page.getByLabel(label).uncheck();
      await page.getByLabel(label).check();
    }

    await page.getByRole("button", { name: /E2E front headline/ }).click();
    await page.getByLabel("Y (in)").fill("0.05");
    await expect(page.getByText(/overlapping a clear zone/)).toBeVisible();
    await expect(page.getByText(/Validation status:\s*WARN/i)).toBeVisible();

    await page.locator("#logo-upload").setInputFiles({
      name: "low-res-logo.png",
      mimeType: "image/png",
      buffer: createPng(120, 60, [185, 28, 28, 255]),
    });
    await expect(page.getByText("Logo uploaded.")).toBeVisible();
    await expect(page.getByText(/uploaded logo appears too small for print quality/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();

    await page.locator("#logo-upload").setInputFiles({
      name: "psg-e2e-logo-valid.png",
      mimeType: "image/png",
      buffer: createPng(1_000, 400, [22, 101, 52, 255]),
    });
    await expect(page.getByText("Logo uploaded.")).toBeVisible();
    await page.getByLabel("Y (in)").fill("0.7");
    await expect(page.getByText("No validation issues.")).toBeVisible();
    await expect(page.getByText(/Validation status:\s*PASS/i)).toBeVisible();

    await page.getByLabel("Side").selectOption("back");
    await page.getByRole("button", { name: "Add text" }).click();
    await page.getByLabel("Text").fill("E2E back copy");

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(`Saved ${draftName}.`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Saved draft")).toContainText(draftName);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Mail artwork editor" })).toBeVisible();
    const savedDraftValue = await page
      .getByLabel("Saved draft")
      .locator("option")
      .filter({ hasText: draftName })
      .getAttribute("value");
    expect(savedDraftValue, "saved draft option value").toBeTruthy();
    await page.getByLabel("Saved draft").selectOption(savedDraftValue!);
    await page.getByRole("button", { name: "Load draft" }).click();
    await expect(page.getByText(`Loaded draft ${draftName}`)).toBeVisible();

    await page.getByLabel("Side").selectOption("front");
    await expect(page.getByText("E2E front headline")).toBeVisible();
    await expect(page.getByAltText("Base graphic")).toBeVisible();
    await expect(page.getByText("No validation issues.")).toBeVisible();

    await page.getByLabel("Side").selectOption("back");
    await expect(page.getByText("E2E back copy")).toBeVisible();

    await page.getByRole("button", { name: /E2E back copy/ }).click();
    await page.getByRole("button", { name: "Delete selected" }).click();
    await expect(page.getByText("E2E back copy")).toHaveCount(0);
  });
});

function createPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const scanlineLength = 1 + width * 4;
  const raw = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y += 1) {
    const offset = y * scanlineLength;
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = offset + 1 + x * 4;
      raw[pixel] = rgba[0];
      raw[pixel + 1] = rgba[1];
      raw[pixel + 2] = rgba[2];
      raw[pixel + 3] = rgba[3];
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data]))),
  ]);
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
