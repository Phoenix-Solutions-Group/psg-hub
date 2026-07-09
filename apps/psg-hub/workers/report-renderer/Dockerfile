# Phase 12 / 12-03 — PSG report-renderer worker container.
# Full puppeteer with bundled Chromium on a host PSG controls (Hetzner). RESEARCH
# refuted Chromium on Vercel Fluid (libnss3.so launch break); this container ships
# the Chromium system libs puppeteer needs. DEPLOY IS THE 12-04 GATE BATCH.
#
# puppeteer's base image already includes Chromium + all required shared libraries
# and a non-root `pptruser`, which avoids the manual apt libnss3/libatk dance.
FROM ghcr.io/puppeteer/puppeteer:24.15.0

# Container env. RENDER_TOKEN is injected at deploy (12-04 secret), never baked in.
ENV PORT=8080 \
    PUPPETEER_SKIP_DOWNLOAD=false

WORKDIR /home/pptruser/app

# Install deps first (layer cache). package-lock optional; pin is in package.json.
COPY --chown=pptruser:pptruser package.json ./
RUN npm install --omit=dev

COPY --chown=pptruser:pptruser *.mjs ./

EXPOSE 8080
CMD ["node", "render.mjs"]
