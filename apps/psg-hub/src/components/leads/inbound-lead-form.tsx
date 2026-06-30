"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FIRST_TOUCH_KEY,
  type Attribution,
  buildInboundPayload,
  extractAttribution,
  mergeFirstTouch,
  parseStoredAttribution,
} from "@/lib/leads/first-touch";

// PSG-500 — Public inbound lead-capture form (interim surface; parent PSG-493).
// Kept cleanly separable from the page so it can be reused/restyled when a fuller
// marketing site lands. Posts to the server endpoint POST /api/leads/inbound
// (PSG-499); the Pipedrive admin token never touches the browser.

type Status = "idle" | "submitting" | "success" | "error";

/** Tolerant localStorage read (private mode / blocked storage -> null). */
function readStored(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredAttribution(window.localStorage.getItem(FIRST_TOUCH_KEY));
  } catch {
    return null;
  }
}

/**
 * Resolve first-touch attribution: a previously-stored snapshot wins, otherwise
 * the current URL's params. Read fresh at submit so it's always correct even if
 * the persistence effect hasn't run. The non-overwriting merge is what makes it
 * "first-touch".
 */
function resolveFirstTouch(): Attribution {
  const incoming =
    typeof window === "undefined"
      ? {}
      : extractAttribution(window.location.search);
  return mergeFirstTouch(readStored(), incoming);
}

export function InboundLeadForm() {
  // Persist first-touch on mount (side-effect only; no render state, so a later
  // visit never clobbers the original touch). Submit reads it back fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = readStored();
    if (stored != null) return; // already captured — first touch wins.
    const incoming = extractAttribution(window.location.search);
    if (Object.keys(incoming).length === 0) return;
    try {
      window.localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(incoming));
    } catch {
      // Storage blocked (private mode); attribution still rides this submit via
      // resolveFirstTouch reading the URL — we just can't persist across visits.
    }
  }, []);

  const [shopName, setShopName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot. Real users never see or fill this; bots that auto-fill get caught.
  const [companyWebsite, setCompanyWebsite] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Mirror the server's "need a way to reach you" rule on the client so the
    // visitor sees it instantly instead of after a round-trip (design review
    // PSG-506, minor polish). The server still enforces it authoritatively.
    if (email.trim() === "" && phone.trim() === "") {
      setError("Add at least an email or a phone number so we can reach you.");
      setStatus("error");
      return;
    }

    setStatus("submitting");

    const payload = buildInboundPayload(
      {
        shopName,
        contactName,
        email,
        phone,
        message,
        company_website: companyWebsite,
      },
      resolveFirstTouch(),
    );

    try {
      const res = await fetch("/api/leads/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok !== true) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("success");
    } catch {
      setError("Network error. Please check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="rounded-xl border border-success/40 bg-success/5 p-6 text-center"
      >
        <h2 className="font-heading text-xl font-bold text-foreground">
          Thanks — we&rsquo;ll be in touch.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your request reached the Phoenix Solutions Group team. We&rsquo;ll
          reach out shortly to set up your demo.
        </p>
      </div>
    );
  }

  const submitting = status === "submitting";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="shopName">Shop / business name</Label>
        <Input
          id="shopName"
          name="shopName"
          autoComplete="organization"
          placeholder="e.g. Sunrise Collision Center"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contactName">Your name</Label>
        <Input
          id="contactName"
          name="contactName"
          autoComplete="name"
          placeholder="First and last name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@shop.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="(555) 555-5555"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Add at least an email or a phone number so we can reach you.
      </p>

      <div className="space-y-2">
        <Label htmlFor="message">How can we help?</Label>
        <textarea
          id="message"
          name="message"
          rows={4}
          placeholder="Tell us about your shop and what you're looking for."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>

      {/* Honeypot — hidden from humans, off-screen + aria-hidden, never tab-reachable. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company_website">Company website (leave blank)</label>
        <input
          id="company_website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={companyWebsite}
          onChange={(e) => setCompanyWebsite(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? "Sending…" : "Request a demo"}
      </Button>
    </form>
  );
}
