"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { handleTabTrap } from "@/lib/ads/focus-trap";

type RequestKind =
  | "budget_change"
  | "campaign_status_change"
  | "new_campaign"
  | "ad_copy_change"
  | "location_change"
  | "destination_change"
  | "performance_review"
  | "problem_report";

type Field = { key: string; label: string; type?: "date" | "number" | "url" | "tel"; placeholder?: string; optional?: boolean };
type RequestDefinition = {
  kind: RequestKind;
  label: string;
  warning: string;
  campaign: boolean;
  fields: Field[];
};

const REQUESTS: RequestDefinition[] = [
  { kind: "budget_change", label: "Change my budget", campaign: true, warning: "Big budget swings can restart Google's learning. PSG will explain if results may dip for 1–2 weeks.", fields: [{ key: "requestedMonthlyBudget", label: "Requested monthly budget", type: "number" }, { key: "reason", label: "Why do you want this change?" }, { key: "requestedDate", label: "When would you like it?", type: "date" }] },
  { kind: "campaign_status_change", label: "Pause or restart a campaign", campaign: true, warning: "Pausing loses some of the history Google uses to find customers. Restarting is not instant.", fields: [{ key: "action", label: "Pause or restart?", placeholder: "Pause or restart" }, { key: "reason", label: "Why?" }, { key: "requestedDate", label: "Requested date", type: "date" }, { key: "pauseUntil", label: "If pausing, until when?" }] },
  { kind: "new_campaign", label: "Talk to us about a new campaign", campaign: false, warning: "A new campaign may change your monthly scope and price. PSG will confirm cost before anything starts.", fields: [{ key: "service", label: "Service to promote" }, { key: "offer", label: "Offer or message" }, { key: "area", label: "Area to cover" }, { key: "startDate", label: "Start date", type: "date" }, { key: "endDate", label: "End date (optional)", type: "date", optional: true }, { key: "budgetGuidance", label: "Monthly budget guidance" , type: "number"}, { key: "landingPage", label: "Landing page (optional)", type: "url", optional: true }, { key: "phoneNumber", label: "Phone number (optional)", type: "tel", optional: true }] },
  { kind: "ad_copy_change", label: "Change what an ad says", campaign: true, warning: "Google reviews new ad text, usually in about one business day. Claims must be ones you can support.", fields: [{ key: "problem", label: "What is wrong?" }, { key: "newWording", label: "Exact new wording" }, { key: "reason", label: "Why should it change?" }] },
  { kind: "location_change", label: "Change where ads show", campaign: true, warning: "Widening the area spreads the same budget thinner unless the budget changes too.", fields: [{ key: "currentArea", label: "Current area" }, { key: "requestedArea", label: "Requested cities, ZIP codes, or radius" }] },
  { kind: "destination_change", label: "Change the phone number or landing page", campaign: true, warning: "PSG must re-check call and form tracking before leads count correctly again.", fields: [{ key: "phoneNumber", label: "New phone number", type: "tel" }, { key: "landingPage", label: "New landing page", type: "url" }] },
  { kind: "performance_review", label: "Ask for a performance review", campaign: false, warning: "No ad change is made. This is a question for PSG's paid-media team.", fields: [{ key: "question", label: "What would you like us to review?" }, { key: "period", label: "Which time period?" }] },
  { kind: "problem_report", label: "Report a problem", campaign: false, warning: "The more specific you can be — which ad, what you saw, roughly when — the faster we can fix it.", fields: [{ key: "problem", label: "What is wrong?" }, { key: "example", label: "Example" }, { key: "occurredAt", label: "When did it happen?" }] },
];

type Props = { shopId: string; campaigns: Array<{ id: string; name: string }>; canSubmit: boolean };

export function getMissingFields(kind: RequestKind, values: Record<string, string>, hasCampaign: boolean): string[] {
  const request = REQUESTS.find((item) => item.kind === kind) ?? REQUESTS[0];
  const missing = request.fields
    .filter((field) => !field.optional && !(kind === "campaign_status_change" && field.key === "pauseUntil" && values.action?.trim().toLowerCase() !== "pause"))
    .filter((field) => !values[field.key]?.trim())
    .map((field) => field.label);
  if (request.campaign && !hasCampaign) missing.unshift("Campaign");
  if (kind === "destination_change") {
    const withoutDestinations = missing.filter((label) => label !== "New phone number" && label !== "New landing page");
    return !values.phoneNumber?.trim() && !values.landingPage?.trim()
      ? [...withoutDestinations, "A new phone number or landing page"]
      : withoutDestinations;
  }
  return missing;
}

export function requestErrorMessage(status?: number): string {
  if (status === 403) return "Only a shop owner or manager can send this request.";
  if (status === 400 || status === 422) return "A field needs attention. Review the missing information and try again.";
  if (status && status >= 500) return "Something went wrong on our side. We've logged it. Please try again later.";
  return "We could not reach PSG. Check your internet connection and try again.";
}

export function isFieldRequired(kind: RequestKind, field: Field, values: Record<string, string>): boolean {
  if (field.optional || kind === "destination_change") return false;
  if (kind === "campaign_status_change" && field.key === "pauseUntil") {
    return values.action?.trim().toLowerCase() === "pause";
  }
  return true;
}

export function getRequestSummary(kind: RequestKind, values: Record<string, string>): Array<{ label: string; value: string }> {
  const request = REQUESTS.find((item) => item.kind === kind) ?? REQUESTS[0];
  return request.fields
    .map((field) => ({ label: field.label, value: values[field.key]?.trim() ?? "" }))
    .filter((item) => item.value);
}

export function CustomerRequestActions({ shopId, campaigns, canSubmit }: Props) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<RequestKind>("budget_change");
  const [campaignId, setCampaignId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = REQUESTS.find((request) => request.kind === kind) ?? REQUESTS[0];
  const campaign = campaigns.find((item) => item.id === campaignId);
  const missingFields = getMissingFields(kind, values, Boolean(campaign));
  const summary = useMemo(() => getRequestSummary(kind, values), [kind, values]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      headingRef.current?.focus();
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [open]);

  function close() { if (!pending) { setOpen(false); setStep(1); setAcknowledged(false); setMessage(null); queueMicrotask(() => triggerRef.current?.focus()); } }
  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("disabled"));
    const plan = handleTabTrap(
      { key: event.key, shiftKey: event.shiftKey },
      { activeIndex: focusables.indexOf(document.activeElement as HTMLElement), count: focusables.length },
    );
    if (plan.prevent && plan.focusIndex !== null) {
      event.preventDefault();
      focusables[plan.focusIndex]?.focus();
    }
  }, []);
  function resetFor(next: RequestKind) { setKind(next); setValues({}); setCampaignId(""); setAcknowledged(false); setReviewAttempted(false); setMessage(null); }
  function submit() {
    setMessage(null);
    startTransition(async () => {
      const requestValues = Object.fromEntries(summary.map((item) => [item.label, item.value]));
      const details = summary.map((item) => `${item.label}: ${item.value}`).join("\n");
      let res: Response;
      try {
        res = await fetch(`/api/shops/${shopId}/google-ads/requests`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestType: selected.kind, campaignId: campaign?.id ?? null, campaignName: campaign?.name ?? null, title: selected.label, details, requestValues, acknowledged }),
        });
      } catch {
        setMessage(requestErrorMessage());
        return;
      }
      if (!res.ok) { setMessage(requestErrorMessage(res.status)); return; }
      close(); setValues({}); setCampaignId(""); setMessage("Request received — waiting for PSG review. Nothing changed in Google Ads."); router.refresh();
    });
  }

  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Nothing you submit here changes a live campaign or your spending. PSG reviews every request first.</p>
    {canSubmit ? <Button ref={triggerRef} className="min-h-11 w-full sm:w-auto" onClick={() => setOpen(true)}>Request a change</Button> : <p className="rounded-md border bg-muted/40 p-3 text-sm">A shop owner or manager can send requests to PSG. Ask one of them to submit this change for your shop.</p>}
    {!open ? <p role="status" className="text-sm font-medium">{message}</p> : null}
    <dialog ref={dialogRef} aria-labelledby="ads-request-title" onKeyDown={trapFocus} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} className="m-0 mt-auto max-h-[92vh] w-full max-w-none overflow-y-auto rounded-t-lg bg-background p-5 text-foreground shadow-xl backdrop:bg-black/50 sm:m-auto sm:max-w-2xl sm:rounded-lg sm:p-6">
      <div>
        <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Step {step} of 2</p><h3 ref={headingRef} tabIndex={-1} id="ads-request-title" className="text-xl font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">{step === 1 ? "Tell PSG what you need" : "Review your request"}</h3></div><Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Close request" onClick={close}><X /></Button></div>
        {step === 1 ? <div className="mt-5 space-y-4">
          <label className="block space-y-1"><span className="text-sm font-medium">Request type</span><select className="min-h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" value={kind} onChange={(event) => resetFor(event.target.value as RequestKind)}>{REQUESTS.map((request) => <option key={request.kind} value={request.kind}>{request.label}</option>)}</select></label>
          {selected.campaign ? <label className="block space-y-1"><span className="text-sm font-medium">Campaign</span><select aria-invalid={reviewAttempted && !campaignId ? true : undefined} className="min-h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">Choose a campaign</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
          {selected.fields.map((field) => <label key={field.key} className="block space-y-1"><span className="text-sm font-medium">{field.label}</span><Input className="min-h-11" required={isFieldRequired(kind, field, values)} type={field.type ?? "text"} placeholder={field.placeholder} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
          <p className="rounded-md bg-muted p-3 text-sm">{selected.warning}</p>
          {missingFields.length ? <p className="text-sm text-destructive">Still needed: {missingFields.join(", ")}.</p> : null}
          <Button className="min-h-11 w-full sm:w-auto" onClick={() => { setReviewAttempted(true); if (!missingFields.length) setStep(2); }}>Review request</Button>
        </div> : <div className="mt-5 space-y-4">
          <dl className="divide-y rounded-md border"><div className="p-3"><dt className="text-xs text-muted-foreground">{"What you're asking for"}</dt><dd className="font-medium">{selected.label}</dd></div><div className="p-3"><dt className="text-xs text-muted-foreground">Which campaign</dt><dd>{campaign?.name ?? "Not about a specific campaign"}</dd></div>{summary.map((item) => <div className="p-3" key={item.label}><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="whitespace-pre-wrap break-words">{item.value}</dd></div>)}</dl>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"><p className="font-medium">Nothing changes right now. Your spending is not affected by sending this.</p><p className="mt-2">PSG reviews this. Nothing in your live Google Ads account changes until a PSG specialist makes the change and confirms it back to you.</p><p className="mt-2">{"PSG reviews every request. We'll reply here as soon as a specialist has looked at it, and you'll see the status update on this page."}</p></div>
          <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm focus-within:ring-3 focus-within:ring-ring/50"><input className="mt-0.5 size-5 accent-primary outline-none" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand this is a request. PSG will review it before anything changes.</span></label>
          {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><Button className="min-h-11" variant="outline" onClick={() => setStep(1)}>Back</Button><Button className="min-h-11" disabled={!acknowledged || pending} onClick={submit}><Send />{pending ? "Sending…" : "Send for PSG review"}</Button></div>
        </div>}
      </div>
    </dialog>
  </div>;
}

export function CustomerReplyForm({ shopId, requestId }: { shopId: string; requestId: string }) {
  const router = useRouter(); const [response, setResponse] = useState(""); const [message, setMessage] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  function submit() { setMessage(null); startTransition(async () => { const res = await fetch(`/api/shops/${shopId}/google-ads/requests/${requestId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response }) }); if (!res.ok) { setMessage("We could not send that detail. Please try again."); return; } setResponse(""); setMessage("Detail sent to PSG."); router.refresh(); }); }
  return <div className="mt-3 space-y-2"><label className="space-y-1"><span className="text-sm font-medium">Your answer</span><textarea value={response} onChange={(event) => setResponse(event.target.value)} className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label><div className="flex flex-wrap items-center gap-3"><Button size="sm" onClick={submit} disabled={pending || response.trim().length < 3}>Send detail</Button><p role="status" className="text-sm text-muted-foreground">{message}</p></div></div>;
}
