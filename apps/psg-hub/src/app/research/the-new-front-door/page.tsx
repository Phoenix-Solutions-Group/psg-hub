import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { WhitepaperDownloadGate } from "./whitepaper-download-gate";

const WHITEPAPER_HTML_PATH = path.join(
  process.cwd(),
  "public",
  "research",
  "the-new-front-door",
  "approved-rev9.html"
);

export const metadata: Metadata = {
  title: "Found When It Matters Most | PSG Flagship White Paper",
  description:
    "A body shop owner's field guide to winning the age of AI search from Phoenix Solutions Group.",
};

function approvedWhitepaperBody() {
  const html = fs.readFileSync(WHITEPAPER_HTML_PATH, "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? "";
  const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? html;

  return { style, body };
}

export default function NewFrontDoorPage() {
  const { style, body } = approvedWhitepaperBody();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <WhitepaperDownloadGate />
    </>
  );
}
