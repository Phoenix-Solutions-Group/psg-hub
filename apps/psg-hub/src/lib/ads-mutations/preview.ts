/**
 * v1.2 Ads Mutation Studio — build-local dry-run preview engine.
 *
 * Pure, dependency-free. Given a registered mutation, this runs the fixture's
 * `apply(before, params)` transform and produces a structured before/after JSON diff
 * for the Studio UI. This is the BUILD-LOCAL path (PSG-26a): it never touches the
 * Vercel Sandbox / Python bridge (gated, see bridge.ts). When the gate clears, the real
 * bridge returns the same `MutationDiff` shape from live data, so the diff UI is unchanged.
 *
 * `Json` is the serializable value type that crosses the server→client boundary; the
 * fixtures' `apply` functions stay server-side — only the computed plain data is exposed.
 */
import type { MutationDef, MutationDiff } from "./types";
import { getMutation, requiresSuperadminApproval } from "./registry";
import { getFixture } from "./fixtures";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type JsonDiffKind = "added" | "removed" | "changed" | "unchanged";

export interface JsonDiffEntry {
  /** Dotted/bracketed path, e.g. `negative_keywords[1].text`. */
  path: string;
  kind: JsonDiffKind;
  before?: Json;
  after?: Json;
}

function isPlainObject(v: Json): v is { [key: string]: Json } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function joinPath(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

/**
 * Recursive structural diff between two JSON values. Leaves (and arrays of differing
 * length / scalars) are compared by value via JSON equality. `includeUnchanged` keeps
 * matching leaves (useful for a full annotated tree); the UI default drops them.
 */
export function diffJson(
  before: Json,
  after: Json,
  opts: { includeUnchanged?: boolean } = {},
  basePath = ""
): JsonDiffEntry[] {
  const out: JsonDiffEntry[] = [];

  // Both plain objects: recurse over the union of keys.
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const inB = key in before;
      const inA = key in after;
      const path = joinPath(basePath, key);
      if (inB && !inA) {
        out.push({ path, kind: "removed", before: before[key] });
      } else if (!inB && inA) {
        out.push({ path, kind: "added", after: after[key] });
      } else {
        out.push(...diffJson(before[key], after[key], opts, path));
      }
    }
    return out;
  }

  // Both arrays: compare index-wise (Google Ads/GTM ops are append/patch oriented).
  if (Array.isArray(before) && Array.isArray(after)) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      const path = joinPath(basePath, i);
      const inB = i < before.length;
      const inA = i < after.length;
      if (inB && !inA) {
        out.push({ path, kind: "removed", before: before[i] });
      } else if (!inB && inA) {
        out.push({ path, kind: "added", after: after[i] });
      } else {
        out.push(...diffJson(before[i], after[i], opts, path));
      }
    }
    return out;
  }

  // Leaf comparison (or shape mismatch, e.g. object→scalar).
  const equal = JSON.stringify(before) === JSON.stringify(after);
  if (!equal) {
    out.push({ path: basePath || "$", kind: "changed", before, after });
  } else if (opts.includeUnchanged) {
    out.push({ path: basePath || "$", kind: "unchanged", before, after });
  }
  return out;
}

export interface PreviewGovernance {
  /** Target (customer-id / container-id) is always required — see governance.ts. */
  targetRequired: true;
  targetKind: MutationDef["target"]["kind"];
  /** Fixture supplies a target; the live UI re-requires operator confirmation. */
  targetProvided: boolean;
  /** High-risk mutations require superadmin/board approval before execute. */
  requiresApproval: boolean;
}

export interface DryRunPreview {
  mutationKey: string;
  def: MutationDef;
  targetRef: string;
  params: Record<string, Json>;
  /** Structured before/requestedChanges/after — same shape the live bridge returns. */
  diff: MutationDiff;
  /** Readable, path-level change summary (changed leaves + added/removed nodes). */
  changes: JsonDiffEntry[];
  governance: PreviewGovernance;
}

/**
 * Build the build-local dry-run preview for one mutation from its fixture.
 * Throws if the key is unknown or has no fixture (a registry/fixture drift bug —
 * the tests assert full coverage so this never fires in practice).
 */
export function buildDryRunPreview(mutationKey: string): DryRunPreview {
  const def = getMutation(mutationKey);
  if (!def) throw new Error(`Unknown mutation key: ${mutationKey}`);
  const fixture = getFixture(mutationKey);
  if (!fixture) throw new Error(`No fixture for mutation key: ${mutationKey}`);

  const before = fixture.before;
  const after = fixture.apply(before, fixture.params);
  const changes = diffJson(before, after);

  return {
    mutationKey,
    def,
    targetRef: fixture.targetRef,
    params: fixture.params,
    diff: { before, requestedChanges: fixture.params, after },
    changes,
    governance: {
      targetRequired: true,
      targetKind: def.target.kind,
      targetProvided: Boolean(fixture.targetRef && fixture.targetRef.trim() !== ""),
      requiresApproval: requiresSuperadminApproval(def),
    },
  };
}

/** Preview every registered mutation (server-side; plain data is safe to pass to the client). */
export function buildAllPreviews(keys: readonly string[]): DryRunPreview[] {
  return keys.map(buildDryRunPreview);
}
