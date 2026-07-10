"use client";

import { useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function AiVisibilityCheckForm() {
  const params = useSearchParams();
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setMessage("");

    const form = event.currentTarget;
    const body = new FormData(form);
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      body.set(key, params.get(key) ?? "");
    }
    body.set("referrer", document.referrer || "");

    try {
      const response = await fetch("/api/leads/ai-visibility-check", {
        method: "POST",
        body,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not submit the request.");
      }

      form.reset();
      setState("success");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not submit the request. Please try again."
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <input
        type="text"
        name="company"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-[#1E3A52]">
          Your name
          <input
            required
            name="name"
            autoComplete="name"
            className="h-12 rounded-md border border-[#D9D3CA] bg-white px-4 font-sans text-base text-[#161616] outline-none transition focus:border-[#B8483E] focus:ring-2 focus:ring-[#B8483E]/20"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-[#1E3A52]">
          Shop name
          <input
            required
            name="shopName"
            autoComplete="organization"
            className="h-12 rounded-md border border-[#D9D3CA] bg-white px-4 font-sans text-base text-[#161616] outline-none transition focus:border-[#B8483E] focus:ring-2 focus:ring-[#B8483E]/20"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium text-[#1E3A52]">
        City or ZIP
        <input
          required
          name="location"
          autoComplete="postal-code"
          className="h-12 rounded-md border border-[#D9D3CA] bg-white px-4 font-sans text-base text-[#161616] outline-none transition focus:border-[#B8483E] focus:ring-2 focus:ring-[#B8483E]/20"
        />
      </label>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-[#1E3A52]">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            className="h-12 rounded-md border border-[#D9D3CA] bg-white px-4 font-sans text-base text-[#161616] outline-none transition focus:border-[#B8483E] focus:ring-2 focus:ring-[#B8483E]/20"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-[#1E3A52]">
          Phone
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            className="h-12 rounded-md border border-[#D9D3CA] bg-white px-4 font-sans text-base text-[#161616] outline-none transition focus:border-[#B8483E] focus:ring-2 focus:ring-[#B8483E]/20"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium text-[#1E3A52]">
        Anything specific you want checked?
        <textarea
          name="notes"
          rows={4}
          className="rounded-md border border-[#D9D3CA] bg-white px-4 py-3 font-sans text-base text-[#161616] outline-none transition focus:border-[#B8483E] focus:ring-2 focus:ring-[#B8483E]/20"
        />
      </label>

      <button
        type="submit"
        disabled={state === "submitting" || state === "success"}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#B8483E] px-5 py-3 font-heading text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-[#9F382F] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "success" ? (
          <>
            Request received
            <CheckCircle2 aria-hidden="true" className="size-4" />
          </>
        ) : (
          <>
            {state === "submitting" ? "Sending request" : "Get my free AI-visibility check"}
            <ArrowRight aria-hidden="true" className="size-4" />
          </>
        )}
      </button>

      {state === "success" ? (
        <p className="text-sm leading-6 text-[#526B51]">
          We received your request. PSG will review how your shop shows up in local search and AI answers, then follow up with a plain-English snapshot.
        </p>
      ) : null}
      {state === "error" ? (
        <p className="text-sm leading-6 text-[#B8483E]">
          {message} You can also email PSG and mention the AI Visibility Check.
        </p>
      ) : null}
    </form>
  );
}
