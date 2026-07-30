#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const referenceRoot = path.join(repoRoot, "docs/harvest/import-repo");
const scanRoots = ["apps", "packages"].map((root) => path.join(repoRoot, root));

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const skippedDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const importPatterns = [
  /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const findings = [];

for (const root of scanRoots) {
  walk(root, inspectFile);
}

if (findings.length > 0) {
  console.error(
    "Import reference boundary violation: product code must not import files from docs/harvest/import-repo.",
  );
  console.error(
    "Port needed logic into apps/psg-hub/src/lib/ops/import/** with hub tests instead.",
  );
  console.error("");

  for (const finding of findings) {
    console.error(
      `- ${path.relative(repoRoot, finding.file)}:${finding.line} imports ${finding.specifier}`,
    );
  }

  process.exit(1);
}

console.log("Import reference boundary check passed.");

function walk(currentPath, onFile) {
  if (!fs.existsSync(currentPath)) {
    return;
  }

  const stat = fs.statSync(currentPath);
  if (stat.isDirectory()) {
    const basename = path.basename(currentPath);
    if (skippedDirs.has(basename)) {
      return;
    }

    for (const entry of fs.readdirSync(currentPath)) {
      walk(path.join(currentPath, entry), onFile);
    }
    return;
  }

  if (stat.isFile() && sourceExtensions.has(path.extname(currentPath))) {
    onFile(currentPath);
  }
}

function inspectFile(file) {
  const source = fs.readFileSync(file, "utf8");

  for (const pattern of importPatterns) {
    pattern.lastIndex = 0;

    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (importsReferenceRoot(file, specifier)) {
        findings.push({
          file,
          line: lineNumberForOffset(source, match.index ?? 0),
          specifier,
        });
      }
    }
  }
}

function importsReferenceRoot(file, specifier) {
  if (
    specifier.includes("docs/harvest/import-repo") ||
    specifier.includes("harvest/import-repo")
  ) {
    return true;
  }

  if (!specifier.startsWith(".")) {
    return false;
  }

  const resolved = path.resolve(path.dirname(file), specifier);
  return resolved === referenceRoot || resolved.startsWith(`${referenceRoot}${path.sep}`);
}

function lineNumberForOffset(source, offset) {
  return source.slice(0, offset).split("\n").length;
}
