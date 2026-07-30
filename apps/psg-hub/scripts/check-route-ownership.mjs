#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appRoot, "../..");
const manifestPath = path.join(
  appRoot,
  "docs/ops/route-ownership/route-ownership-manifest.json",
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const ROUTE_FILE_NAMES = new Set(["page.tsx", "page.ts", "route.ts", "route.tsx"]);
const SKIP_DIRS = new Set([".next", "node_modules"]);

function walkRouteFiles(rootDir) {
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }

      if (entry.isFile() && ROUTE_FILE_NAMES.has(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  }

  walk(rootDir);
  return files.sort();
}

function routeFromFile(appDir, filePath) {
  const relative = path.relative(appDir, path.dirname(filePath));
  const parts = relative
    .split(path.sep)
    .filter(Boolean)
    .filter((part) => !(part.startsWith("(") && part.endsWith(")")));

  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function patternToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function uniqueRoutes(files, appDir) {
  return [...new Set(files.map((file) => routeFromFile(appDir, file)))].sort();
}

function formatList(values) {
  return values.length ? values.map((value) => `  - ${value}`).join("\n") : "  - none";
}

const familyMatchers = manifest.routeFamilies.map((family) => ({
  id: family.id,
  matchers: family.patterns.map((pattern) => patternToRegExp(pattern)),
}));

const hubAppDir = path.join(appRoot, "src/app");
const legacyAppDir = path.join(repoRoot, manifest.legacyPortal.path, "src/app");

if (!existsSync(hubAppDir) || !statSync(hubAppDir).isDirectory()) {
  throw new Error(`Hub app directory missing: ${hubAppDir}`);
}

if (!existsSync(legacyAppDir) || !statSync(legacyAppDir).isDirectory()) {
  throw new Error(`Legacy app directory missing: ${legacyAppDir}`);
}

if (manifest.legacyPortal.status !== "reference-only") {
  throw new Error("Legacy portal must stay labelled reference-only until a separate approved archival task changes it.");
}

const hubRoutes = uniqueRoutes(walkRouteFiles(hubAppDir), hubAppDir);
const legacyRoutes = uniqueRoutes(walkRouteFiles(legacyAppDir), legacyAppDir);
const legacyRouteSet = new Set(legacyRoutes);

const unowned = [];
const multiOwned = [];

for (const route of hubRoutes) {
  const matches = familyMatchers
    .filter((family) => family.matchers.some((matcher) => matcher.test(route)))
    .map((family) => family.id);

  if (matches.length === 0) {
    unowned.push(route);
  } else if (matches.length > 1) {
    multiOwned.push(`${route} (${matches.join(", ")})`);
  }
}

const allowedOverlapSet = new Set(manifest.allowedLegacyOverlaps.map((entry) => entry.route));
const actualOverlaps = hubRoutes.filter((route) => legacyRouteSet.has(route));
const unapprovedOverlaps = actualOverlaps.filter((route) => !allowedOverlapSet.has(route));
const staleAllowedOverlaps = [...allowedOverlapSet].filter((route) => !actualOverlaps.includes(route));

const failures = [];
if (unowned.length) {
  failures.push(`Unowned hub routes:\n${formatList(unowned)}`);
}

if (multiOwned.length) {
  failures.push(`Routes matched more than one ownership family:\n${formatList(multiOwned)}`);
}

if (unapprovedOverlaps.length) {
  failures.push(`Unapproved exact overlaps with psg-advantage-portal:\n${formatList(unapprovedOverlaps)}`);
}

if (staleAllowedOverlaps.length) {
  failures.push(`Allowed legacy overlaps that no longer exist and should be removed:\n${formatList(staleAllowedOverlaps)}`);
}

if (failures.length) {
  console.error("Route ownership check failed.\n");
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(
  [
    "Route ownership check passed.",
    `Hub routes checked: ${hubRoutes.length}`,
    `Legacy routes checked: ${legacyRoutes.length}`,
    `Approved exact overlaps: ${actualOverlaps.length}`,
  ].join("\n"),
);
