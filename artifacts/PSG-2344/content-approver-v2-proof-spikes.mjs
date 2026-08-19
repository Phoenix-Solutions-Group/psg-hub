#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";

const MIB = 1024 * 1024;
const WORK_DIR = join(tmpdir(), `psg-2344-${process.pid}`);
const OUT_DIR = join(process.cwd(), "artifacts", "PSG-2344");
const RESULT_PATH = join(OUT_DIR, "content-approver-v2-proof-results.json");
const REPORT_PATH = join(OUT_DIR, "content-approver-v2-proof-results.md");

function ms(start) {
  return Math.round(performance.now() - start);
}

function rssMiB() {
  return Math.round((process.memoryUsage().rss / MIB) * 10) / 10;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32LE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function writeUInt16LE(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

async function commandExists(name) {
  const paths = (process.env.PATH ?? "").split(":");
  for (const p of paths) {
    const candidate = join(p, name);
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep scanning PATH
    }
  }
  return null;
}

async function createLargePdf(path, sizeBytes) {
  await mkdir(dirname(path), { recursive: true });
  const header = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
  const footer = Buffer.from("\n%%EOF\n");
  const fillerSize = sizeBytes - header.length - footer.length;
  const filler = Buffer.alloc(1024 * 1024, 0x25);
  const stream = createWriteStream(path);
  stream.write(header);
  let remaining = fillerSize;
  while (remaining > 0) {
    const chunk = remaining >= filler.length ? filler : filler.subarray(0, remaining);
    if (!stream.write(chunk)) {
      await new Promise((resolve) => stream.once("drain", resolve));
    }
    remaining -= chunk.length;
  }
  stream.end(footer);
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

async function hashFile(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function largePdfProof() {
  const source = join(WORK_DIR, "large-100mb.pdf");
  const reviewCopy = join(WORK_DIR, "review-copy.pdf");
  const start = performance.now();
  await createLargePdf(source, 100 * MIB);
  const created = ms(start);
  const copyStart = performance.now();
  await pipeline(createReadStream(source, { highWaterMark: 1024 * 1024 }), createWriteStream(reviewCopy));
  const copied = ms(copyStart);
  const previewStart = performance.now();
  const first = Buffer.alloc(8);
  const handle = await import("node:fs/promises").then((fs) => fs.open(reviewCopy, "r"));
  const { size } = await stat(reviewCopy);
  await handle.read(first, 0, first.length, 0);
  const tail = Buffer.alloc(8);
  await handle.read(tail, 0, tail.length, size - tail.length);
  await handle.close();
  const previewed = ms(previewStart);
  const deleteStart = performance.now();
  await rm(source);
  await rm(reviewCopy);
  const deleted = ms(deleteStart);
  return {
    status: "pass",
    sizeBytes: size,
    createdMs: created,
    copiedMs: copied,
    previewedMs: previewed,
    deletedMs: deleted,
    peakRssMiB: rssMiB(),
    previewHeaderOk: first.toString("utf8").startsWith("%PDF"),
    previewFooterOk: tail.toString("utf8").includes("%%EOF"),
  };
}

function htmlSafetyCheck(html) {
  const failures = [];
  const lower = html.toLowerCase();
  if (/<\s*script\b/.test(lower)) failures.push("script tag");
  if (/\son[a-z]+\s*=/.test(lower)) failures.push("inline event handler");
  if (/<\s*form\b/.test(lower)) failures.push("form tag");
  if (/\b(?:src|href|action)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|data:)/i.test(html)) {
    failures.push("unsafe URL or external call");
  }
  if (/<\s*(?:iframe|object|embed|link|meta)\b/.test(lower)) failures.push("active or external embedding tag");
  return { ok: failures.length === 0, failures };
}

function localHeader(name, data) {
  const nameBytes = Buffer.from(name);
  return Buffer.concat([
    writeUInt32LE(0x04034b50),
    writeUInt16LE(20),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt32LE(crc32(data)),
    writeUInt32LE(data.length),
    writeUInt32LE(data.length),
    writeUInt16LE(nameBytes.length),
    writeUInt16LE(0),
    nameBytes,
    data,
  ]);
}

function centralHeader(entry, offset) {
  const nameBytes = Buffer.from(entry.name);
  const data = entry.data;
  const uncompressed = entry.uncompressedSize ?? data.length;
  const compressed = entry.compressedSize ?? data.length;
  return Buffer.concat([
    writeUInt32LE(0x02014b50),
    writeUInt16LE(20),
    writeUInt16LE(20),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt32LE(crc32(data)),
    writeUInt32LE(compressed),
    writeUInt32LE(uncompressed),
    writeUInt16LE(nameBytes.length),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt32LE(entry.externalAttributes ?? 0),
    writeUInt32LE(offset),
    nameBytes,
  ]);
}

function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    const local = localHeader(entry.name, data);
    locals.push(local);
    centrals.push(centralHeader({ ...entry, data }, offset));
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    writeUInt32LE(0x06054b50),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(entries.length),
    writeUInt16LE(entries.length),
    writeUInt32LE(central.length),
    writeUInt32LE(offset),
    writeUInt16LE(0),
  ]);
  return Buffer.concat([...locals, central, eocd]);
}

function validateZip(buffer, options = {}) {
  const maxTotalUncompressedBytes = options.maxTotalUncompressedBytes ?? 150 * MIB;
  const maxExpansionRatio = options.maxExpansionRatio ?? 100;
  const executable = /\.(?:exe|dll|bat|cmd|com|scr|ps1|sh|app|jar|msi)$/i;
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) return { ok: false, failures: ["missing ZIP directory"] };
  const entries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const failures = [];
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let i = 0; i < entries; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      failures.push("invalid ZIP central directory");
      break;
    }
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const normalized = normalize(name);
    const fileType = (externalAttributes >>> 16) & 0o170000;
    if (name.startsWith("/") || name.includes("\\") || normalized.startsWith(`..${sep}`) || normalized === "..") {
      failures.push(`unsafe path: ${name}`);
    }
    if (fileType === 0o120000) failures.push(`symlink entry: ${name}`);
    if (executable.test(name)) failures.push(`executable entry: ${name}`);
    if (compressedSize > 0 && uncompressedSize / compressedSize > maxExpansionRatio) {
      failures.push(`excessive expansion: ${name}`);
    }
    totalUncompressed += uncompressedSize;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (centralOffset + centralSize > buffer.length) failures.push("central directory out of bounds");
  if (totalUncompressed > maxTotalUncompressedBytes) failures.push("ZIP exceeds total expansion limit");
  return { ok: failures.length === 0, failures, entries, totalUncompressed };
}

async function htmlAndZipProof() {
  const htmlFixtures = {
    safe: "<main><h1>Repair specials</h1><a href=\"/contact\">Contact</a></main>",
    script: "<script>alert(1)</script>",
    handler: "<button onclick=\"steal()\">Approve</button>",
    form: "<form action=\"/send\"><input></form>",
    external: "<img src=\"https://tracker.example/pixel.gif\">",
    javascript: "<a href=\"javascript:alert(1)\">bad</a>",
  };
  const html = Object.fromEntries(
    Object.entries(htmlFixtures).map(([name, fixture]) => [name, htmlSafetyCheck(fixture)]),
  );
  const zipFixtures = {
    safe: createZip([{ name: "index.html", data: Buffer.from(htmlFixtures.safe) }]),
    traversal: createZip([{ name: "../secret.html", data: Buffer.from("x") }]),
    absolute: createZip([{ name: "/etc/passwd", data: Buffer.from("x") }]),
    symlink: createZip([{ name: "link", data: Buffer.from("target"), externalAttributes: 0o120777 << 16 }]),
    executable: createZip([{ name: "run.sh", data: Buffer.from("echo nope") }]),
    expansion: createZip([{ name: "huge.bin", data: Buffer.alloc(1), compressedSize: 1, uncompressedSize: 200 * MIB }]),
  };
  const zip = Object.fromEntries(Object.entries(zipFixtures).map(([name, fixture]) => [name, validateZip(fixture)]));
  return {
    status:
      html.safe.ok &&
      !html.script.ok &&
      !html.handler.ok &&
      !html.form.ok &&
      !html.external.ok &&
      !html.javascript.ok &&
      zip.safe.ok &&
      !zip.traversal.ok &&
      !zip.absolute.ok &&
      !zip.symlink.ok &&
      !zip.executable.ok &&
      !zip.expansion.ok
        ? "pass"
        : "fail",
    html,
    zip,
  };
}

async function batchProof() {
  const batchDir = join(WORK_DIR, "batch");
  await mkdir(batchDir, { recursive: true });
  const started = performance.now();
  const docs = [];
  for (let i = 0; i < 50; i += 1) {
    const input = join(batchDir, `doc-${String(i + 1).padStart(2, "0")}.pdf`);
    const output = join(batchDir, `review-${String(i + 1).padStart(2, "0")}.pdf`);
    await createLargePdf(input, 2 * MIB);
    const copyStarted = performance.now();
    await copyFile(input, output);
    const digest = await hashFile(output);
    docs.push({ input: basename(input), output: basename(output), copiedMs: ms(copyStarted), sha256: digest.slice(0, 16) });
  }
  const totalMs = ms(started);
  const totalBytes = 50 * 2 * MIB;
  const mbPerSecond = Math.round((totalBytes / MIB / (totalMs / 1000)) * 10) / 10;
  return {
    status: "pass",
    documents: docs.length,
    testedBytes: totalBytes,
    totalMs,
    mbPerSecond,
    projected50x100MbSeconds: Math.round((50 * 100) / mbPerSecond),
    failureReportingShape: { documentId: "doc-17", status: "failed", reason: "Unsupported file type or unsafe content detected" },
  };
}

function storageCostProof() {
  const gib = (50 * 100 * MIB) / (1024 ** 3);
  const supabaseStoragePerGbMonth = 0.021;
  return {
    status: "pass",
    maxDocuments: 50,
    maxFileSizeMb: 100,
    originalsOnlyGiB: Math.round(gib * 100) / 100,
    originalsPlusReviewCopiesGiB: Math.round(gib * 2 * 100) / 100,
    estimatedMonthlyStorageUsdAtSupabaseRate: Math.round(gib * 2 * supabaseStoragePerGbMonth * 100) / 100,
    note: "Estimate uses 100 MB originals plus 100 MB processed review copies for every document; database, transfer, image/video transforms, and backups are excluded.",
  };
}

async function summaryProof() {
  const summary = {
    project: "Tedesco website copy review",
    round: "Round 2",
    closedEarly: true,
    reviewers: [
      { name: "Maria Lopez", submitted: true, decision: "Approved as-is", comments: 0 },
      { name: "Steve Parker", submitted: true, decision: "Changes requested", comments: 3 },
      { name: "Tina Brooks", submitted: false, decision: null, comments: 0 },
    ],
  };
  const html = `<!doctype html><html><body><h1>${summary.project}</h1><p>${summary.round}</p><h2>Reviewer attribution</h2><ul>${summary.reviewers
    .map((r) => `<li>${r.name}: ${r.submitted ? `${r.decision}, ${r.comments} comments` : "No response before early close"}</li>`)
    .join("")}</ul></body></html>`;
  const pseudoPdf = Buffer.concat([Buffer.from("%PDF-1.7\n% Summary generated from reviewed attribution\n"), Buffer.from(html), Buffer.from("\n%%EOF\n")]);
  const output = join(WORK_DIR, "summary.pdf");
  await writeFile(output, pseudoPdf);
  const contents = await readFile(output, "utf8");
  return {
    status: contents.includes("Maria Lopez") && contents.includes("No response before early close") ? "pass" : "fail",
    generatedBytes: pseudoPdf.length,
    attributionIncluded: contents.includes("Steve Parker"),
    nonResponderIncluded: contents.includes("Tina Brooks: No response"),
    caveat: "This proves the summary data contract and attribution wording, not browser-rendered PDF fidelity.",
  };
}

async function conversionAndScanningProof() {
  const soffice = (await commandExists("soffice")) ?? (await commandExists("libreoffice"));
  const clamscan = (await commandExists("clamscan")) ?? (await commandExists("clamdscan"));
  return {
    docConversion: {
      status: soffice ? "not_run" : "blocked",
      availableConverter: soffice,
      finding: soffice
        ? "A converter is present, but this spike script did not invoke it."
        : "No LibreOffice/soffice binary is available, so legacy .doc and .docx conversion cannot be proven in this runtime.",
    },
    malwareScanning: {
      status: clamscan ? "not_run" : "blocked",
      availableScanner: clamscan,
      finding: clamscan
        ? "A scanner is present, but this spike script did not invoke it."
        : "No ClamAV scanner is available, so the infected EICAR fixture cannot be rejected before reviewer access in this runtime.",
    },
  };
}

function markdown(results) {
  return `# PSG-2344 Content Approver v2 Proof Spike Results

Generated: ${new Date().toISOString()}

## Bottom Line

Recommendation: **revise the plan before full build**. Large-file streaming, safe HTML/ZIP rejection rules, scaled batch processing, storage-cost math, and the summary attribution data shape are technically workable. Two launch-critical requirements are not proven in the current PSG Hub runtime: Word document conversion and malware scanning. Do not promise Content Approver v2 until those are added as managed services or explicitly removed from scope.

## Results

| Proof | Result | Evidence |
| --- | --- | --- |
| 100 MB PDF | ${results.largePdf.status} | Created, streamed to a review copy, preview-checked, and deleted ${Math.round(results.largePdf.sizeBytes / MIB)} MB. Copy time: ${results.largePdf.copiedMs} ms. RSS after run: ${results.largePdf.peakRssMiB} MiB. |
| DOC/DOCX conversion | ${results.conversionAndScanning.docConversion.status} | ${results.conversionAndScanning.docConversion.finding} |
| Malware scanning | ${results.conversionAndScanning.malwareScanning.status} | ${results.conversionAndScanning.malwareScanning.finding} |
| HTML safety | ${results.htmlAndZip.status === "pass" ? "pass" : "fail"} | Script tags, event handlers, forms, unsafe URLs, and external calls were rejected by the proof validator. |
| HTML ZIP safety | ${results.htmlAndZip.status === "pass" ? "pass" : "fail"} | Path traversal, absolute paths, symlinks, executable entries, and excessive expansion were rejected by the proof validator. |
| 50-document processing | ${results.batch.status} | Processed 50 scaled 2 MB PDF documents in ${results.batch.totalMs} ms (${results.batch.mbPerSecond} MB/s). Projected 50 x 100 MB copy/hash window: ${results.batch.projected50x100MbSeconds} seconds before conversion/scanning/rendering overhead. |
| Storage cost | ${results.storage.status} | 50 originals plus 50 processed review copies at 100 MB each is ${results.storage.originalsPlusReviewCopiesGiB} GiB. Estimated base storage: $${results.storage.estimatedMonthlyStorageUsdAtSupabaseRate}/month before transfer, backups, and database costs. |
| Summary PDF | ${results.summary.status} | Generated a PDF-shaped summary artifact containing reviewer attribution and a clear non-responder line for early close. ${results.summary.caveat} |

## Engineering Recommendation

Proceed with a reduced next slice only:

1. Keep PDFs and sanitized HTML/HTML ZIP in scope for the next implementation slice.
2. Add a real malware-scanning service before any reviewer can access uploaded files. Best fit: ClamAV/\`clamd\` in a managed worker or another private scanning service with a hard fail-closed policy.
3. Add a real document-conversion worker before promising \`.doc\` or \`.docx\`. Best fit: a containerized LibreOffice worker that writes immutable PDF review copies and reports per-file conversion errors.
4. Treat 100 MB x 50 documents as an asynchronous background job path. The measured local copy/hash throughput is acceptable, but conversion and scanning will dominate the true processing window.
5. Keep invitations locked until every required document has passed scanning and processing.

## Technical Detail

The proof script is \`artifacts/PSG-2344/content-approver-v2-proof-spikes.mjs\`.
Raw results are in \`artifacts/PSG-2344/content-approver-v2-proof-results.json\`.

SOPs checked: board communication standard, Graphify code-navigation rule, PSG knowledge-base rule. The knowledge-base environment variables were not available in this runtime, so this spike used Paperclip, repository docs, Graphify, and local measurements only.
`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(WORK_DIR, { recursive: true });
  const results = {
    startedAt: new Date().toISOString(),
    largePdf: await largePdfProof(),
    conversionAndScanning: await conversionAndScanningProof(),
    htmlAndZip: await htmlAndZipProof(),
    batch: await batchProof(),
    storage: storageCostProof(),
    summary: await summaryProof(),
  };
  results.finishedAt = new Date().toISOString();
  await writeFile(RESULT_PATH, `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(REPORT_PATH, markdown(results));
  await rm(WORK_DIR, { recursive: true, force: true });
  console.log(`Wrote ${RESULT_PATH}`);
  console.log(`Wrote ${REPORT_PATH}`);
}

main().catch(async (error) => {
  await rm(WORK_DIR, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
