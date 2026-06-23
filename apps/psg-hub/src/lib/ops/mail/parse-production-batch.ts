// W0 / PSG-223 — Parse a production-center envelope artifact into recipient blocks.
//
// The dated production-center batch (docs/psg/production-center/
// production-files-sample/<YYYY-MM-DD>/) is the per-recipient send record for that
// mailing: one markdown file per (piece, component), e.g. `13-envelope-09-07.md`.
// The *envelope* component is the addressed artifact — it lists every recipient
// the piece was mailed to. Each recipient block is page-break (form-feed)
// delimited and shaped:
//
//   PS218                         <- PSGID (shop key), possibly indented after \f
//
//   Mr. Stephen Moore             <- name
//   2930 North Swan Road          <- street line(s) (0..2; unit on its own line)
//   Tucson, Arizona 85712         <- City, State ZIP
//
// This module is pure string parsing (no PII normalization/hashing — that is the
// importer's job). It returns the raw blocks plus the piece metadata read from
// the filename.

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

/**
 * Split an envelope artifact's markdown into raw recipient blocks. Each block
 * begins at a PSGID marker and runs until the next marker (or EOF). The first
 * non-empty line after the address lines start is the name; the last line that
 * looks like 'City, State ZIP' ends the address; lines between are street/unit.
 */
export function parseEnvelopeMarkdown(content: string): ParsedRecipient[] {
  // Drop YAML frontmatter, then normalize page-break (\f / \x0c) to newlines so
  // indented "(\f)PSxxx" markers stand alone.
  const body = content.replace(FRONTMATTER_RE, "").replace(/\f/g, "\n");

  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !HEADING_RE.test(l));

  const blocks: ParsedRecipient[] = [];
  let current: { psgid: string; lines: string[] } | null = null;
  let index = 0;

  const flush = () => {
    if (!current) return;
    const addrLines = current.lines;
    index += 1;
    const rawName = addrLines[0] ?? "";
    // Find the City/State/ZIP line scanning from the end.
    let cszIdx = -1;
    for (let i = addrLines.length - 1; i >= 1; i -= 1) {
      if (CITY_STATE_ZIP_RE.test(addrLines[i])) {
        cszIdx = i;
        break;
      }
    }
    const rawCityStateZip = cszIdx >= 0 ? addrLines[cszIdx] : null;
    const rawStreetLines =
      cszIdx >= 1 ? addrLines.slice(1, cszIdx) : addrLines.slice(1);
    blocks.push({
      psgid: current.psgid,
      rawName,
      rawStreetLines,
      rawCityStateZip,
      index,
    });
  };

  for (const line of lines) {
    if (PSGID_RE.test(line)) {
      flush();
      current = { psgid: line, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
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
