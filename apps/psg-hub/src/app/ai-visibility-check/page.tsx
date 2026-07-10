import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AiVisibilityCheckForm } from "./request-form";

export const metadata: Metadata = {
  title: "Free AI Visibility Check | Phoenix Solutions Group",
  description:
    "Request a free PSG check of how your collision-repair shop appears in local search and AI answers.",
};

export default function AiVisibilityCheckPage() {
  return (
    <main className="min-h-screen bg-[#FAF8F5] text-[#161616]">
      <section className="border-b border-[#D9D3CA] bg-[#1E3A52] text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/research/the-new-front-door" className="inline-flex items-center gap-2 text-sm text-[#DCE3EA] transition hover:text-white">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to report
          </Link>
          <Logo variant="reverse" className="h-9 w-auto" />
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:py-20">
        <div>
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-[#B8483E]">
            Free request
          </p>
          <h1 className="mt-4 max-w-xl font-heading text-4xl font-medium leading-tight text-[#1E3A52] md:text-5xl">
            Find out whether your shop shows up when customers ask AI.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#4A4257]">
            We will check how your shop appears in local search and popular AI answers, then send a plain-English snapshot of what shows up and what to fix first.
          </p>
          <div className="mt-8 grid gap-4 border-l-2 border-[#B8483E] pl-5 text-base leading-7 text-[#4A4257]">
            <p>No obligation.</p>
            <p>No sales pitch.</p>
            <p>Built for independent collision-repair shops.</p>
          </div>
        </div>

        <div className="rounded-lg border border-[#D9D3CA] bg-white p-6 shadow-[0_18px_60px_rgba(30,58,82,0.12)] md:p-8">
          <AiVisibilityCheckForm />
        </div>
      </section>
    </main>
  );
}
