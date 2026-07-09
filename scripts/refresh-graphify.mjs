#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const outDir = join(repoRoot, "graphify-out");
const persistentGraphify =
  "/paperclip/instances/default/companies/a38dde7c-f8ee-4901-804d-bf1d6887dbf0/codex-home/tools/graphify-venv/bin/graphify";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || "";
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}\n${detail}`);
  }

  return (result.stdout || "").trim();
}

function findGraphify() {
  const envPath = process.env.GRAPHIFY_BIN;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  const pathResult = spawnSync("bash", ["-lc", "command -v graphify"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (pathResult.status === 0 && pathResult.stdout.trim()) {
    return pathResult.stdout.trim();
  }

  if (existsSync(persistentGraphify)) {
    return persistentGraphify;
  }

  return null;
}

const graphify = findGraphify();
if (!graphify) {
  console.error(
    "Graphify CLI not found. Install graphifyy or set GRAPHIFY_BIN to the graphify executable.",
  );
  process.exit(1);
}

run(graphify, ["update", "."]);

mkdirSync(outDir, { recursive: true });

const commit = run("git", ["rev-parse", "HEAD"], { capture: true });
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
const refreshedAt = new Date().toISOString();
const version = run(graphify, ["--version"], { capture: true });

const freshness = {
  refreshedAt,
  commit,
  branch,
  graphifyVersion: version,
  command: `${graphify} update .`,
};

writeFileSync(join(outDir, "freshness.json"), `${JSON.stringify(freshness, null, 2)}\n`);
writeFileSync(
  join(outDir, "FRESHNESS.md"),
  [
    "# Graphify Freshness",
    "",
    `- Last refreshed: ${refreshedAt}`,
    `- Git commit: ${commit}`,
    `- Branch: ${branch}`,
    `- Graphify version: ${version}`,
    `- Refresh command: \`${graphify} update .\``,
    "",
  ].join("\n"),
);

console.log(`Graphify refreshed at ${refreshedAt} for ${commit}.`);
