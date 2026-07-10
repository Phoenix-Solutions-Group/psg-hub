import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { whitepaperMarkdown } from "./whitepaper";

const CTA_HREF =
  "/ai-visibility-check?utm_source=whitepaper&utm_medium=owned-site&utm_campaign=new-front-door&utm_content=whitepaper-cta";

export const metadata: Metadata = {
  title: "The New Front Door | Phoenix Solutions Group Research",
  description:
    "How AI is rewiring the way local collision-repair shops get found, and what every shop owner should do about it.",
};

function inlineMarkdown(text: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s|]+|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={index} href={link[2]} className="font-medium text-[#B8483E] underline decoration-[#B8483E]/30 underline-offset-4 hover:decoration-[#B8483E]" rel="noreferrer" target="_blank">
          {link[1]}
        </a>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={index} href={part} className="font-medium text-[#B8483E] underline decoration-[#B8483E]/30 underline-offset-4 hover:decoration-[#B8483E]" rel="noreferrer" target="_blank">
          {part}
        </a>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function renderTable(lines: string[], key: string) {
  const rows = lines
    .filter((line) => !/^\|\s*-/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const [head, ...body] = rows;

  return (
    <div key={key} className="my-8 overflow-x-auto rounded-md border border-[#D9D3CA] bg-white">
      <table className="min-w-full border-collapse text-left text-sm leading-6">
        <thead className="bg-[#F1F4F7] text-[#1E3A52]">
          <tr>
            {head.map((cell, index) => (
              <th key={index} className="border-b border-[#D9D3CA] px-4 py-3 font-heading font-medium">
                {inlineMarkdown(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[#E8E1D9] last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="min-w-40 px-4 py-3 align-top text-[#4A4257]">
                  {inlineMarkdown(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WhitepaperArticle() {
  const elements: React.ReactNode[] = [];
  const lines = whitepaperMarkdown.split("\n");
  let tableLines: string[] = [];

  const flushTable = () => {
    if (tableLines.length > 0) {
      elements.push(renderTable(tableLines, `table-${elements.length}`));
      tableLines = [];
    }
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (line.startsWith("|")) {
      tableLines.push(line);
      return;
    }

    flushTable();

    if (!line) return;
    if (line === "---") {
      elements.push(<hr key={index} className="my-10 border-[#D9D3CA]" />);
      return;
    }
    if (line.startsWith("# ")) return;
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={index} className="mt-9 font-heading text-2xl font-medium leading-tight text-[#1E3A52]">
          {inlineMarkdown(line.slice(4))}
        </h3>
      );
      return;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={index} className="mt-12 font-heading text-3xl font-medium leading-tight text-[#1E3A52]">
          {inlineMarkdown(line.slice(3))}
        </h2>
      );
      return;
    }
    if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={index} className="my-4 border-l-2 border-[#B8483E] bg-[#FAEEEC] px-5 py-4 text-lg leading-8 text-[#1E3A52]">
          {inlineMarkdown(line.replace(/^>\s?#{0,2}\s?/, ""))}
        </blockquote>
      );
      return;
    }
    if (/^\d+\.\s/.test(line)) {
      elements.push(
        <p key={index} className="pl-5 text-lg leading-8 text-[#4A4257]">
          {inlineMarkdown(line)}
        </p>
      );
      return;
    }
    if (line.startsWith("- ")) {
      elements.push(
        <p key={index} className="pl-5 text-lg leading-8 text-[#4A4257] before:mr-3 before:text-[#B8483E] before:content-['•']">
          {inlineMarkdown(line.slice(2))}
        </p>
      );
      return;
    }

    elements.push(
      <p key={index} className="text-lg leading-8 text-[#4A4257]">
        {inlineMarkdown(line)}
      </p>
    );
  });

  flushTable();

  return <>{elements}</>;
}

export default function NewFrontDoorPage() {
  return (
    <main className="min-h-screen bg-[#FAF8F5] text-[#161616]">
      <section className="bg-[#1E3A52] text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Logo variant="reverse" className="h-10 w-auto" />
          <Link href={CTA_HREF} className="hidden rounded-md border border-white/25 px-4 py-2 font-heading text-xs font-medium uppercase tracking-[0.08em] text-white transition hover:border-white md:inline-flex">
            Book your free AI-visibility check
          </Link>
        </div>
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-16 pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:pb-20 lg:pt-16">
          <div>
            <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-[#D88378]">
              Phoenix Solutions Group Research Report
            </p>
            <h1 className="mt-5 max-w-3xl font-heading text-5xl font-medium leading-[1.04] md:text-7xl">
              The online &quot;front door&quot; for body shops just moved.
            </h1>
            <p className="mt-7 max-w-2xl text-xl leading-9 text-[#DCE3EA]">
              For twenty years, getting found meant ranking #1 on Google. In 2026, more and more customers just ask an AI &quot;who&apos;s the best body shop near me?&quot; — and it names one or two shops. This free report explains what&apos;s changed and the three things that decide whether your shop is the one it names.
            </p>
            <p className="mt-6 text-base italic text-[#DCE3EA]">
              A Phoenix Solutions Group Research Report · Phoenix Solutions Group — Research & Insights
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#report" className="inline-flex min-h-12 items-center justify-center rounded-md bg-white px-5 py-3 font-heading text-sm font-medium uppercase tracking-[0.08em] text-[#1E3A52] transition hover:bg-[#F1F4F7]">
                Read the report
              </a>
              <Link href={CTA_HREF} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#B8483E] px-5 py-3 font-heading text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-[#9F382F]">
                Book your free AI-visibility check
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>
          <div className="border-l border-white/20 pl-6 text-[#DCE3EA] lg:self-end">
            <p className="font-heading text-sm uppercase tracking-[0.18em] text-white">Inside the report</p>
            <div className="mt-5 grid gap-5 text-lg leading-8">
              <p>Why zero-click search changes the fight for local customers.</p>
              <p>What Google Business Profiles and fresh reviews now decide.</p>
              <p>How independent collision shops can still out-punch larger chains.</p>
            </div>
          </div>
        </div>
      </section>

      <article id="report" className="mx-auto w-full max-w-4xl px-6 py-14 md:py-20">
        <WhitepaperArticle />
      </article>

      <section className="bg-[#1E3A52] px-6 py-14 text-white md:py-18">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-heading text-3xl font-medium md:text-4xl">Curious where your shop stands?</h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[#DCE3EA]">
              We&apos;ll run a free, no-obligation check: when someone asks a popular AI tool for a body shop in your area, does your shop come up — and what do your reviews say when it does? You&apos;ll get a plain-English snapshot, no sales pitch.
            </p>
          </div>
          <Link href={CTA_HREF} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-[#B8483E] px-5 py-3 font-heading text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-[#9F382F]">
            Book your free AI-visibility check
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
