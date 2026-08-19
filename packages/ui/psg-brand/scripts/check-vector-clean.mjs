#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assertCleanVectorFile } from "./vector-path.mjs";

const VECTOR_EXTENSIONS = new Set([".svg", ".eps", ".pdf"]);

async function listVectorFiles(targetPath) {
  const info = await stat(targetPath);
  if (info.isFile()) {
    return VECTOR_EXTENSIONS.has(path.extname(targetPath).toLowerCase()) ? [targetPath] : [];
  }

  if (!info.isDirectory()) return [];

  const entries = await readdir(targetPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => listVectorFiles(path.join(targetPath, entry.name))),
  );
  return nested.flat();
}

const targets = process.argv.slice(2).filter((arg) => arg !== "--");
if (targets.length === 0) {
  console.error("Usage: node scripts/check-vector-clean.mjs <file-or-directory> [...]");
  process.exit(2);
}

const files = (await Promise.all(targets.map((target) => listVectorFiles(target)))).flat();

for (const file of files) {
  await assertCleanVectorFile(file);
}

console.log(`VERIFY: scanned ${files.length} vector files for NaN/Infinity/undefined - 0 corrupt.`);
