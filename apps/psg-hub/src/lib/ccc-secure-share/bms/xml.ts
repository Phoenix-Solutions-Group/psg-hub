// PSG-261 / CCC Secure Share Phase 1B — minimal, pure XML reader.
//
// CIECA BMS estimate documents are machine-generated, well-formed XML. The ops
// import backbone only ships a *spreadsheet* decoder (SheetJS, for
// SpreadsheetML) — there is no general XML capability to reuse, and the parent
// issue's guiding principle is "no external dependency" for the BMS domain core.
// So this is a small, dependency-free, side-effect-free recursive-descent reader
// scoped to exactly what a BMS estimate needs: elements, attributes, text,
// CDATA, comments, processing instructions, the DOCTYPE, and entity decoding.
//
// It is intentionally NOT a general-purpose/streaming XML engine — no DTD
// validation, no namespace resolution (prefixes are stripped to local names,
// which is all the BMS data dictionary mapping needs), no mixed-content model
// beyond concatenating an element's direct text. That keeps it auditable and
// fast for the bounded BMS document shape.

export type XmlNode = {
  /** Local element name with any namespace prefix stripped (e.g. "bms:VIN" -> "VIN"). */
  name: string;
  /** Attribute map, keyed by local attribute name, values entity-decoded. */
  attributes: Record<string, string>;
  /** Direct child elements, in document order. */
  children: XmlNode[];
  /** Concatenated, trimmed direct text content of the element. */
  text: string;
};

export class XmlParseError extends Error {
  constructor(message: string) {
    super(`Malformed XML: ${message}`);
    this.name = "XmlParseError";
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** Decode the five predefined XML entities plus decimal/hex numeric refs. */
export function decodeEntities(input: string): string {
  if (input.indexOf("&") < 0) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Strip a namespace prefix ("ns:Foo" -> "Foo"); leaves unprefixed names alone. */
function localName(raw: string): string {
  const colon = raw.indexOf(":");
  return colon >= 0 ? raw.slice(colon + 1) : raw;
}

const NAME_CHAR = /[A-Za-z0-9_:.\-]/;
const WS = /\s/;

/**
 * Parse a BMS/XML document into a tree of {@link XmlNode}. Returns the single
 * root element. Throws {@link XmlParseError} on malformed input (unterminated
 * constructs, mismatched close tags, missing root) rather than guessing — a
 * mis-parsed estimate must fail loudly, never silently drop dollars.
 */
export function parseXml(input: string): XmlNode {
  const src = input.replace(/^﻿/, "");
  const n = src.length;
  let i = 0;

  const skipWs = (): void => {
    while (i < n && WS.test(src[i])) i++;
  };

  // Skip whitespace, comments, processing instructions, and declarations
  // (<?xml?>, <!DOCTYPE>) that may appear in the prolog or between content.
  const skipMisc = (): void => {
    for (;;) {
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        if (end < 0) throw new XmlParseError("unterminated comment");
        i = end + 3;
      } else if (src.startsWith("<?", i)) {
        const end = src.indexOf("?>", i + 2);
        if (end < 0) throw new XmlParseError("unterminated processing instruction");
        i = end + 2;
      } else if (src.startsWith("<!", i)) {
        const end = src.indexOf(">", i + 2);
        if (end < 0) throw new XmlParseError("unterminated declaration");
        i = end + 1;
      } else if (i < n && WS.test(src[i])) {
        skipWs();
      } else {
        break;
      }
    }
  };

  const readName = (): string => {
    const start = i;
    while (i < n && NAME_CHAR.test(src[i])) i++;
    if (i === start) throw new XmlParseError(`expected a name at offset ${start}`);
    return src.slice(start, i);
  };

  const parseElement = (): XmlNode => {
    // src[i] is '<' and the next char begins a name.
    i++; // consume '<'
    const rawName = readName();
    const attributes: Record<string, string> = {};

    for (;;) {
      skipWs();
      if (i >= n) throw new XmlParseError(`unterminated start tag <${rawName}>`);
      if (src[i] === "/" && src[i + 1] === ">") {
        i += 2;
        return { name: localName(rawName), attributes, children: [], text: "" };
      }
      if (src[i] === ">") {
        i++;
        break;
      }
      const attrName = localName(readName());
      skipWs();
      if (src[i] !== "=") throw new XmlParseError(`expected '=' after attribute ${attrName}`);
      i++;
      skipWs();
      const quote = src[i];
      if (quote !== '"' && quote !== "'") throw new XmlParseError(`unquoted attribute ${attrName}`);
      i++;
      const end = src.indexOf(quote, i);
      if (end < 0) throw new XmlParseError(`unterminated attribute ${attrName}`);
      attributes[attrName] = decodeEntities(src.slice(i, end));
      i = end + 1;
    }

    const children: XmlNode[] = [];
    let text = "";
    for (;;) {
      if (i >= n) throw new XmlParseError(`unexpected end of input inside <${rawName}>`);
      if (src.startsWith("<![CDATA[", i)) {
        const end = src.indexOf("]]>", i + 9);
        if (end < 0) throw new XmlParseError("unterminated CDATA section");
        text += src.slice(i + 9, end);
        i = end + 3;
      } else if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        if (end < 0) throw new XmlParseError("unterminated comment");
        i = end + 3;
      } else if (src.startsWith("<?", i)) {
        const end = src.indexOf("?>", i + 2);
        if (end < 0) throw new XmlParseError("unterminated processing instruction");
        i = end + 2;
      } else if (src.startsWith("</", i)) {
        i += 2;
        const closeName = readName();
        skipWs();
        if (src[i] !== ">") throw new XmlParseError(`unterminated close tag </${closeName}>`);
        i++;
        if (localName(closeName) !== localName(rawName)) {
          throw new XmlParseError(`mismatched close tag </${closeName}> for <${rawName}>`);
        }
        break;
      } else if (src[i] === "<") {
        children.push(parseElement());
      } else {
        const lt = src.indexOf("<", i);
        const chunk = lt < 0 ? src.slice(i) : src.slice(i, lt);
        text += decodeEntities(chunk);
        i = lt < 0 ? n : lt;
      }
    }

    return { name: localName(rawName), attributes, children, text: text.trim() };
  };

  skipMisc();
  if (i >= n || src[i] !== "<") throw new XmlParseError("no root element found");
  const root = parseElement();
  skipMisc();
  if (i < n) throw new XmlParseError("unexpected content after root element");
  return root;
}

// ── Tree-navigation helpers (case-insensitive on local element names) ────────
// BMS uses PascalCase element names from the data dictionary; matching
// case-insensitively keeps the mapper resilient to casing drift between the
// spec-derived fixture and a real CCC export.

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** First direct child element with the given local name, or undefined. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => eq(c.name, name));
}

/** All direct child elements with the given local name. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => eq(c.name, name)) ?? [];
}

/**
 * Follow a path of local names from `node` and return the trimmed text of the
 * final element, or "" if any segment is missing. e.g. text(root, "VehicleInfo",
 * "VIN").
 */
export function text(node: XmlNode | undefined, ...path: string[]): string {
  let cur: XmlNode | undefined = node;
  for (const seg of path) {
    cur = child(cur, seg);
    if (!cur) return "";
  }
  return cur?.text ?? "";
}

/** Depth-first search for the first descendant (or self) with the given name. */
export function find(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  if (eq(node.name, name)) return node;
  for (const c of node.children) {
    const hit = find(c, name);
    if (hit) return hit;
  }
  return undefined;
}
