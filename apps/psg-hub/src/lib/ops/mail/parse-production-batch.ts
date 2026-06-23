// W0 / PSG-223 — Parse a production-center envelope artifact into recipient blocks.
//
// The dated production-center batch (docs/psg/production-center/
// production-files-sample/<YYYY-MM-DD>/) is the per-recipient send record for that
// mailing: one markdown file per (piece, component), e.g. `13-envelope-09-07.md`.
// The *envelope* component is the addressed artifact — it lists every recipient
// the piece was mailed to. Recipients are delimited by the PSGID (shop code),
// which is printed both as a leading marker and as a page-break (form-feed)
// footer. A recipient block runs from one PSGID marker to the next.
//
// Two real layouts (both observed in the 2021-09-07 batch) are handled:
//
//   col-0 (most pieces — t, 13, 16, 10b, …):     warranty pieces (07, 04b — a
//     PS218                                       marketing line shares the name's
//                                                 row, left-aligned):
//     Mr. Stephen Moore                             PS760
//     2930 North Swan Road
//     Tucson, Arizona 85712                         Your Repair Warranty Enclosed   Smsgt. Warren Weakley
//                                                                                   425 Southwest B B Highway
//                                                                                   Warrensburg, Missouri 64093
//
// The address lines are aligned in a column; the name sits in that same column on
// its row, with any marketing prefix to its left. So the name is recovered by
// slicing the name row at the address column (the indent of the first address
// line). For col-0 pieces the indent is 0 and the whole row is the name.
//
// This module is pure string parsing — NO PII normalization/hashing (that is the
// importer's job, via the injected MailHasher). It returns raw blocks + the piece
// metadata read from the filename.

import type { ParsedRecipient, PieceVariant } from "./types";

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const PSGID_RE = /^PS\d+$/;
const HEADING_RE = /^#\s/;
// 'City, State ZIP' / 'City, State ZIP-4'. State is a spelled-out name or code.
const CITY_STATE_ZIP_RE = /^(.+?),\s*([A-Za-z][A-Za-z .]*?)\s+(\d{5})(?:-\d{4})?$/;

export type EnvelopeFileMeta = {
  pieceCode: string;
  pieceVariant: PieceVariant | null;
};

/**
 * Read piece metadata from a production-center filename like
 * `04b-envelope-09-07.md` -> { pieceCode: '04b', pieceVariant: 'envelope' }.
 * Returns null when the name doesn't match the convention.
 */
export function parseEnvelopeFilename(filename: string): EnvelopeFileMeta | null {
  const base = filename.replace(/^.*\//, "");
  const m = base.match(
    /^([A-Za-z0-9]+)-(letter|envelope|warranty|survey)-\d{2}-\d{2}\.md$/i,
  );
  if (!m) return null;
  return {
    pieceCode: m[1].toLowerCase(),
    pieceVariant: m[2].toLowerCase() as PieceVariant,
  };
}

/** Leading whitespace width of a line. */
function indentOf(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * Build one ParsedRecipient from the raw (leading-space-preserving) content lines
 * of a block. The name is recovered from the address-column alignment so a
 * left-column marketing prefix on warranty pieces is dropped, not hashed.
 */
function buildRecipient(
  psgid: string,
  rawLines: string[],
  index: number,
): ParsedRecipient {
  const nameRow = rawLines[0] ?? "";
  // Address column = indent of the first address row (the line after the name).
  const addrIndent = rawLines.length > 1 ? indentOf(rawLines[1]) : 0;
  const rawName =
    addrIndent > 0 && nameRow.length > addrIndent
      ? nameRow.slice(addrIndent).trim()
      : nameRow.trim();

  // Remaining rows, trimmed of the alignment column, are street(s) + city/state/zip.
  const rest = rawLines
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // The city/state/zip is the last line that matches; everything before it (still
  // within the block) is street/unit.
  let cszIdx = -1;
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    if (CITY_STATE_ZIP_RE.test(rest[i])) {
      cszIdx = i;
      break;
    }
  }
  const rawCityStateZip = cszIdx >= 0 ? rest[cszIdx] : null;
  const rawStreetLines = cszIdx >= 0 ? rest.slice(0, cszIdx) : rest;

  return { psgid, rawName, rawStreetLines, rawCityStateZip, index };
}

/**
 * Split an envelope artifact's markdown into raw recipient blocks. Each block
 * opens at a PSGID marker and runs until the next marker (leading-marker rule:
 * every recipient inherits the shop of the marker above it). The trailing
 * page-footer marker at EOF opens an empty block, which is dropped (not a reject).
 */
export function parseEnvelopeMarkdown(content: string): ParsedRecipient[] {
  // Drop YAML frontmatter, then turn page-breaks (\f / \x0c) into newlines so an
  // indented "(\f)PSxxx" footer marker stands alone on its own line.
  const body = content.replace(FRONTMATTER_RE, "").replace(/\f/g, "\n");

  const blocks: ParsedRecipient[] = [];
  let psgid = "";
  let current: string[] | null = null;
  let index = 0;

  const flush = () => {
    if (current === null) return;
    const lines = current;
    current = null;
    // Empty block = the trailing page-footer marker at EOF (structural, not data).
    if (lines.length === 0) return;
    index += 1;
    blocks.push(buildRecipient(psgid, lines, index));
  };

  for (const raw of body.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue; // blank padding between blocks
    if (HEADING_RE.test(trimmed)) continue; // '# 07_Envelope_09-07'
    if (PSGID_RE.test(trimmed)) {
      flush();
      psgid = trimmed;
      current = [];
      continue;
    }
    // Keep the raw line (with leading spaces) so the name column can be recovered.
    if (current) current.push(raw);
  }
  flush();

  return blocks;
}

/** Split a 'City, State ZIP' line into parts, or null when it doesn't match. */
export function splitCityStateZip(
  line: string | null,
): { city: string; state: string; zip: string } | null {
  if (!line) return null;
  const m = line.match(CITY_STATE_ZIP_RE);
  if (!m) return null;
  return { city: m[1].trim(), state: m[2].trim(), zip: m[3].trim() };
}
