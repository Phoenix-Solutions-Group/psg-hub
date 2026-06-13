// Phase 12 / 12-03 — Controlled-host Chromium PDF worker (Hetzner).
// RESEARCH: Chromium cannot launch on Vercel Fluid (libnss3.so break), so the
// branded print route is rendered to PDF on a host PSG controls. This is a tiny
// HTTP server with ONE endpoint:
//
//   POST /  { "url": "<print-route URL>" }   Authorization: Bearer ${RENDER_TOKEN}
//     -> 200 application/pdf  (printBackground, Letter)
//     -> 401 on a bad/missing token
//
// The same RENDER_TOKEN authenticates BOTH hops: this worker checks the incoming
// bearer, and forwards it as page.setExtraHTTPHeaders so the print route (which is
// itself RENDER_TOKEN-gated) authorizes the page.goto. Because the bearer is forwarded,
// the requested URL is allowlisted to EXACTLY the print route on REPORT_APP_ORIGIN before
// any navigation (assertAllowedPrintUrl) — otherwise a token holder could aim the worker
// and its bearer at an arbitrary or internal target (SSRF / token forwarding).
//
// DEPLOY IS THE 12-04 GATE BATCH. This file is authored + version-pinned in-repo
// now; it is built into the container (Dockerfile) and run on Hetzner at activation.
// REPORT_APP_ORIGIN must be set at deploy (e.g. https://hub.psgweb.me) or every render
// fails closed with 400. The app gains NO dependency from this directory — puppeteer
// lives in this worker's OWN package.json only.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import puppeteer from "puppeteer";
import { assertAllowedPrintUrl } from "./url-allowlist.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.RENDER_TOKEN ?? "";
const APP_ORIGIN = process.env.REPORT_APP_ORIGIN ?? "";

/** Constant-time bearer check against RENDER_TOKEN. */
function authorized(req) {
  if (!TOKEN) return false;
  const header = req.headers["authorization"] ?? "";
  const expected = `Bearer ${TOKEN}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// One shared browser instance, reused across requests (cold start is expensive).
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
}

async function renderPdf(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Forward the bearer so the RENDER_TOKEN-gated print route authorizes page.goto.
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${TOKEN}` });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
    // CRITICAL: networkidle0 does NOT guarantee @font-face faces are applied before
    // capture. Without this the PDF silently falls back to system fonts.
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ printBackground: true, format: "Letter" });
  } finally {
    await page.close();
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("unauthorized");
    return;
  }
  try {
    const raw = await readBody(req);
    const { url } = JSON.parse(raw || "{}");
    let target;
    try {
      // Allowlist BEFORE navigation: only the print route on REPORT_APP_ORIGIN is
      // reachable, so the forwarded bearer can never be aimed elsewhere.
      target = assertAllowedPrintUrl(url, APP_ORIGIN);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end(`bad url: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const pdf = await renderPdf(target.href);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
    });
    res.end(pdf);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`render failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(PORT, () => {
  console.log(`report-renderer listening on :${PORT}`);
});
