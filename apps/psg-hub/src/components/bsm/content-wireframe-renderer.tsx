import type { ReactNode } from "react";
import {
  isContentWireframeHrefSafe,
  type ContentWireframeManifest,
} from "@/lib/bsm/content-wireframe";

const INLINE_LINK_RE = /\[([^\]]+)]\(([^)]+)\)/g;

function inlineContent(text: string): ReactNode[] {
  const content: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(INLINE_LINK_RE)) {
    const index = match.index ?? 0;
    if (index > offset) content.push(text.slice(offset, index));
    const href = match[2].trim();
    content.push(isContentWireframeHrefSafe(href) ? (
      <a
        key={`${index}:${href}`}
        href={href}
        className="font-medium text-ember underline underline-offset-2"
        {...(/^https?:\/\//i.test(href) ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {match[1].trim()}
      </a>
    ) : match[0]);
    offset = index + match[0].length;
  }
  if (offset < text.length) content.push(text.slice(offset));
  return content;
}

export function ContentWireframeRenderer({
  manifest,
  assetUrl,
  renderText,
}: {
  manifest: ContentWireframeManifest;
  assetUrl?: (assetId: string) => string | null;
  renderText?: (blockId: string, text: string, blockOffset?: number) => ReactNode;
}) {
  const text = (blockId: string, value: string, blockOffset = 0) => renderText?.(blockId, value, blockOffset) ?? inlineContent(value);
  return (
    <article aria-label="Content Wireframe" className="overflow-hidden rounded-xl border border-border bg-white text-[#142838] shadow-sm">
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-950">
        <strong>Content and structure review only.</strong>{" "}
        Approval covers copy, hierarchy, CTA intent, selected images, and block order; it does not approve final design or production launch.
      </div>
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-8 sm:px-10 sm:py-12">
        {manifest.blocks.map((block) => {
          if (block.kind === "hero") return <h1 key={block.id} data-review-block={block.id} className="font-heading text-3xl font-semibold sm:text-5xl">{text(block.id, block.text)}</h1>;
          if (block.kind === "section") return <h2 key={block.id} data-review-block={block.id} className="pt-4 font-heading text-2xl font-semibold sm:text-3xl">{text(block.id, block.text)}</h2>;
          if (block.kind === "paragraph") return <p key={block.id} data-review-block={block.id} className="max-w-3xl text-base leading-7 text-[#405463]">{text(block.id, block.text)}</p>;
          if (block.kind === "callout") return <blockquote key={block.id} data-review-block={block.id} className="border-l-4 border-ember bg-[#f7f8f9] px-5 py-4 text-lg italic leading-8">{text(block.id, block.text)}</blockquote>;
          if (block.kind === "unordered_list" || block.kind === "ordered_list") {
            const List = block.kind === "ordered_list" ? "ol" : "ul";
            let blockOffset = 0;
            return <List key={block.id} data-review-block={block.id} className="ml-6 space-y-2 text-base leading-7 text-[#405463] [list-style:revert]">{block.items.map((item, index) => {
              const offset = blockOffset;
              blockOffset += item.length;
              return <li key={`${block.id}:${index}`}>{text(block.id, item, offset)}</li>;
            })}</List>;
          }
          if (block.kind === "cta") {
            const safe = isContentWireframeHrefSafe(block.href, false);
            return <div key={block.id} data-review-block={block.id}>{safe ? <a href={block.href} className="inline-flex rounded-md bg-ember px-4 py-3 font-medium text-white">{text(block.id, block.text)}</a> : <span className="inline-flex rounded-md bg-slate-300 px-4 py-3 font-medium text-slate-700">{text(block.id, block.text)}</span>}</div>;
          }
          if (block.kind === "faq") return <section key={block.id} data-review-block={block.id} className="rounded-lg border border-border p-5"><h3 className="font-heading text-xl font-semibold">{text(block.id, block.question)}</h3><p className="mt-2 leading-7 text-[#405463]">{text(block.id, block.answer)}</p></section>;
          if (block.kind !== "image") return null;
          const src = assetUrl?.(block.assetId) ?? null;
          return <figure key={block.id} data-review-block={block.id} className="overflow-hidden rounded-lg border border-dashed border-border bg-[#f7f8f9]">{src ? <img src={src} alt={block.alt} className="max-h-[560px] w-full object-contain" /> : <div role="img" aria-label={block.alt || "Image placeholder"} className="grid min-h-48 place-items-center p-6 text-center text-sm text-muted-foreground">Private Content Asset {block.assetId}</div>}</figure>;
        })}
      </div>
    </article>
  );
}
