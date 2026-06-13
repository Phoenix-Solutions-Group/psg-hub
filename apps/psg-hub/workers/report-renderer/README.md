# report-renderer (Phase 12 monthly-report PDF worker)

Controlled-host Chromium worker that turns the psg-hub internal print route into a
branded PDF. RESEARCH refuted Chromium on Vercel Fluid Compute (the `libnss3.so`
launch break), so the PDF is rendered on a host PSG controls (Hetzner).

This directory is **self-contained**: `puppeteer` is declared in this worker's own
`package.json`, NOT in the psg-hub app. The app calls this worker over HTTP via
`src/lib/report/render-client.ts` and gains no Chromium dependency.

## Contract

```
POST /            { "url": "<print-route URL>" }   Authorization: Bearer ${RENDER_TOKEN}
  -> 200 application/pdf   (printBackground: true, format: Letter)
  -> 401                   bad / missing bearer
  -> 400                   url not allowlisted (origin / path / private-host) or missing
GET  /health      -> 200 ok
```

The same `RENDER_TOKEN` authenticates both hops: the worker validates the incoming
bearer and forwards it as `page.setExtraHTTPHeaders({ Authorization })` so the
RENDER_TOKEN-gated print route authorizes `page.goto`. The worker awaits
`document.fonts.ready` before `page.pdf()` so the brand `@font-face` faces are
applied (networkidle0 alone does not guarantee this).

**URL allowlist (SSRF / token-forwarding guard).** Because the privileged bearer is
forwarded to the navigated URL, the worker accepts ONLY the report print route on the
configured app origin. Before navigating it runs `assertAllowedPrintUrl` (see
`url-allowlist.mjs`): the URL must be `http(s)`, its origin must equal `REPORT_APP_ORIGIN`,
its path must match `/reports/{slug}/print`, and its host must not be loopback / private /
link-local. Anything else returns 400 with no navigation. `REPORT_APP_ORIGIN` MUST be set
at deploy (e.g. `https://hub.psgweb.me`) or every render fails closed.

## DEPLOY = Phase 12 / 12-04 gate batch (NOT done in 12-03)

12-03 authors + version-pins this worker. Activation at 12-04:

1. Build + push the image (`docker build -t psg-report-renderer .`).
2. Run on Hetzner with `RENDER_TOKEN` set (matches the app's `RENDER_TOKEN`) AND
   `REPORT_APP_ORIGIN` set to the app origin (e.g. `https://hub.psgweb.me`). Without
   `REPORT_APP_ORIGIN` every render fails closed (400 url not allowlisted).
3. Set the app secrets: `REPORT_RENDER_URL` (this worker's URL) + `RENDER_TOKEN`.
4. One live render smoke: a real generate -> render -> store -> download end-to-end.
