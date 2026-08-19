"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

type RequestKind = "campaign_adjustment" | "new_campaign";

type Props = {
  shopId: string;
  campaigns: Array<{ id: string; name: string }>;
};

const REQUESTS: Array<{
  label: string;
  requestType: RequestKind;
  title: string;
  placeholder: string;
}> = [
  {
    label: "Request an ad change",
    requestType: "campaign_adjustment",
    title: "Ad change request",
    placeholder: "Tell us what needs to change and why.",
  },
  {
    label: "Request a new campaign",
    requestType: "new_campaign",
    title: "New campaign request",
    placeholder: "Tell us the service, market, offer, and timing.",
  },
  {
    label: "Request a performance check-up",
    requestType: "campaign_adjustment",
    title: "Performance check-up request",
    placeholder: "Tell us what you want PSG to review.",
  },
];

export function CustomerRequestActions({ shopId, campaigns }: Props) {
  const router = useRouter();
  const [openLabel, setOpenLabel] = useState(REQUESTS[0].label);
  const [details, setDetails] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [budgetNotes, setBudgetNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = REQUESTS.find((item) => item.label === openLabel) ?? REQUESTS[0];

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const campaign = campaigns.find((item) => item.id === campaignId);
      const res = await fetch(`/api/shops/${shopId}/google-ads/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: selected.requestType,
          campaignId: campaign?.id ?? null,
          campaignName: campaign?.name ?? null,
          title: selected.title,
          details,
          budgetNotes: budgetNotes || null,
        }),
      });
      if (!res.ok) {
        setMessage("We could not send this request. Please add more detail and try again.");
        return;
      }
      setDetails("");
      setCampaignId("");
      setBudgetNotes("");
      setMessage("Request received.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" aria-label="Google Ads request type">
        {REQUESTS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              setOpenLabel(item.label);
              setMessage(null);
            }}
            aria-pressed={item.label === openLabel}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              item.label === openLabel
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
        <label className="space-y-1">
          <span className="text-sm font-medium">{selected.label}</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder={selected.placeholder}
            className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="space-y-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">Campaign</span>
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">General request</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Budget notes</span>
            <input
              value={budgetNotes}
              onChange={(event) => setBudgetNotes(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={pending || details.trim().length < 10}>
          <Send aria-hidden="true" />
          {pending ? "Sending" : "Send request"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}

export function CustomerReplyForm({
  shopId,
  requestId,
}: {
  shopId: string;
  requestId: string;
}) {
  const router = useRouter();
  const [response, setResponse] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/shops/${shopId}/google-ads/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (!res.ok) {
        setMessage("We could not send that detail. Please try again.");
        return;
      }
      setResponse("");
      setMessage("Detail sent to PSG.");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <label className="space-y-1">
        <span className="text-sm font-medium">Your answer</span>
        <textarea
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={submit} disabled={pending || response.trim().length < 3}>
          Send detail
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}
