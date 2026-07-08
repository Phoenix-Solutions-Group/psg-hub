#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const [, , queryArg, graphArg = "graphify-out/graph.json"] = process.argv;

if (!queryArg) {
  console.error("Usage: node scripts/measure-graphify-token-savings.mjs <symbol-or-term> [graph.json]");
  process.exit(1);
}

const root = process.cwd();
const graphPath = resolve(root, graphArg);

if (!existsSync(graphPath)) {
  console.error(`Missing Graphify graph at ${graphArg}. Run graphify update . first.`);
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const query = queryArg.toLowerCase();
const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
const links = Array.isArray(graph.links) ? graph.links : [];

const matches = nodes
  .filter((node) =>
    [node.label, node.id, node.source_file]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  )
  .slice(0, 25);

if (matches.length === 0) {
  console.error(`No graph nodes matched "${queryArg}". Try a concrete symbol or filename.`);
  process.exit(2);
}

const matchIds = new Set(matches.map((node) => node.id));
const relatedLinks = links
  .filter((link) => matchIds.has(link.source) || matchIds.has(link.target))
  .slice(0, 75);

const nodesById = new Map(nodes.map((node) => [node.id, node]));
const relatedNodeIds = new Set(matches.map((node) => node.id));
for (const link of relatedLinks) {
  relatedNodeIds.add(link.source);
  relatedNodeIds.add(link.target);
}

const graphAnswer = [
  `Graph query: ${queryArg}`,
  "",
  "Matched nodes:",
  ...matches.map(formatNode),
  "",
  "Neighbor edges:",
  ...relatedLinks.map((link) => {
    const source = nodesById.get(link.source);
    const target = nodesById.get(link.target);
    return `- ${formatNode(source)} --${link.relation ?? "related"}--> ${formatNode(target)}`;
  }),
].join("\n");

const sourceFiles = [...new Set([...relatedNodeIds].map((id) => nodesById.get(id)?.source_file).filter(Boolean))]
  .filter((file) => existsSync(resolve(root, file)) && statSync(resolve(root, file)).isFile())
  .slice(0, 25);

const rawContext = sourceFiles
  .map((file) => `# ${file}\n${readFileSync(resolve(root, file), "utf8")}`)
  .join("\n\n");

const graphTokens = estimateTokens(graphAnswer);
const rawTokens = estimateTokens(rawContext);
const reduction = rawTokens === 0 ? 0 : (1 - graphTokens / rawTokens) * 100;

console.log(JSON.stringify(
  {
    query: queryArg,
    matchedNodes: matches.length,
    neighborEdges: relatedLinks.length,
    sourceFiles: sourceFiles.length,
    graphContextEstimatedTokens: graphTokens,
    rawFilesEstimatedTokens: rawTokens,
    estimatedReductionPercent: Number(reduction.toFixed(1)),
    graphBuiltAtCommit: graph.built_at_commit ?? null,
    note: "Token counts are a chars/4 estimate for a repeatable local trend check, not a billing meter.",
  },
  null,
  2,
));

function formatNode(node) {
  if (!node) return "(missing node)";
  const location = [node.source_file, node.source_location].filter(Boolean).join(":");
  return `- ${node.label ?? node.id}${location ? ` (${location})` : ""}`;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
