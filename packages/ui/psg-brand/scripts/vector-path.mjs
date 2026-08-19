import { readFile } from "node:fs/promises";

export const VECTOR_CORRUPTION_PATTERN = /NaN|Infinity|undefined/;

function cleanNumber(value, places = 3) {
  if (!Number.isFinite(value)) {
    throw new Error(`Vector path contains a non-finite coordinate: ${String(value)}`);
  }

  const fixed = Number(value).toFixed(places);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

function commandType(command) {
  const type = command?.type ?? command?.command;
  return typeof type === "string" ? type.toUpperCase() : "";
}

function commandNumber(command, key, places) {
  if (typeof command?.[key] !== "number") {
    throw new Error(`Vector path command ${commandType(command) || "(unknown)"} is missing ${key}`);
  }

  return cleanNumber(command[key], places);
}

export function serializePath(pathOrCommands, options = {}) {
  const places = options.places ?? 3;
  const commands = Array.isArray(pathOrCommands) ? pathOrCommands : pathOrCommands?.commands;

  if (!Array.isArray(commands)) {
    throw new Error("serializePath expected an opentype.js Path or a command array");
  }

  return commands
    .map((command) => {
      switch (commandType(command)) {
        case "M":
          return `M${commandNumber(command, "x", places)} ${commandNumber(command, "y", places)}`;
        case "L":
          return `L${commandNumber(command, "x", places)} ${commandNumber(command, "y", places)}`;
        case "C":
          return [
            "C",
            commandNumber(command, "x1", places),
            commandNumber(command, "y1", places),
            commandNumber(command, "x2", places),
            commandNumber(command, "y2", places),
            commandNumber(command, "x", places),
            commandNumber(command, "y", places),
          ].join(" ");
        case "Q":
          return [
            "Q",
            commandNumber(command, "x1", places),
            commandNumber(command, "y1", places),
            commandNumber(command, "x", places),
            commandNumber(command, "y", places),
          ].join(" ");
        case "Z":
          return "Z";
        default:
          throw new Error(`Unsupported vector path command: ${commandType(command) || "(missing)"}`);
      }
    })
    .join(" ");
}

export function assertCleanVectorText(text, label = "vector output") {
  const match = String(text).match(VECTOR_CORRUPTION_PATTERN);
  if (match) {
    throw new Error(`${label} contains corrupt vector data token: ${match[0]}`);
  }
}

export async function assertCleanVectorFile(filePath) {
  const text = await readFile(filePath, "utf8");
  assertCleanVectorText(text, filePath);
}
