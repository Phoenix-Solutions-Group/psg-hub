"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  CLIENT_CAMPAIGN_TEMPLATES,
  type ClientCampaignTemplate,
} from "@/lib/ads/campaign-templates";
import {
  dollarsToMicros,
  formatMicrosAsUsd,
  validateCampaignCreate,
} from "@/lib/ads/campaigns-client";
import { handleTabTrap } from "@/lib/ads/focus-trap";

type Props = {
  shopId: string;
  shopName: string;
  maxDailyMicros: number;
  onClose: () => void;
};

export function CreateCampaignModal({
  shopId,
  shopName,
  maxDailyMicros,
  onClose,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [template, setTemplate] = useState<ClientCampaignTemplate | null>(null);
  const [name, setName] = useState("");
  const [dollars, setDollars] = useState("50.00");
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    firstFocusRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openerRef.current?.focus();
    };
  }, [onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute("disabled"));
    const activeIndex = focusables.indexOf(
      document.activeElement as HTMLElement
    );
    const plan = handleTabTrap(
      { key: e.key, shiftKey: e.shiftKey },
      { activeIndex, count: focusables.length }
    );
    if (plan.prevent && plan.focusIndex !== null) {
      e.preventDefault();
      focusables[plan.focusIndex]?.focus();
    }
  }, []);

  function pickTemplate(t: ClientCampaignTemplate) {
    setTemplate(t);
    setName(`${shopName} — ${t.name}`);
    setDollars(((t.default_daily_budget_micros / 1_000_000) as number).toFixed(2));
    setError(null);
    setMissing(null);
  }

  async function onSubmit() {
    if (!template) return;
    setError(null);
    setMissing(null);

    const d2m = dollarsToMicros(Number(dollars));
    if (!d2m.ok) {
      setError(
        d2m.reason === "precision_exceeded"
          ? "Daily budget must have at most 2 decimal places."
          : "Daily budget must be a positive number."
      );
      return;
    }

    const check = validateCampaignCreate({
      name,
      dailyBudgetMicros: d2m.micros,
      maxDailyMicros,
    });
    if (!check.ok) {
      setError(
        {
          name_empty: "Name is required.",
          name_too_long: "Name must be 255 characters or fewer.",
          budget_invalid: "Daily budget must be a positive number.",
          budget_over_cap: `Daily budget exceeds the cap (${formatMicrosAsUsd(maxDailyMicros)}).`,
        }[check.reason] ?? check.reason
      );
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/ads/google/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_id: shopId,
          template_id: template.id,
          daily_budget_micros: d2m.micros,
          name: name.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 && Array.isArray(data.missing)) {
          setMissing(data.missing);
          return;
        }
        setError(
          typeof data.error === "string" ? data.error : `Failed (${res.status})`
        );
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-campaign-title"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-md border bg-background p-6 shadow-lg"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="create-campaign-title" className="text-lg font-semibold">
              Create campaign
            </h2>
            <p className="text-sm text-muted-foreground">
              Start from a PSG collision-repair template.
            </p>
          </div>
          <button
            ref={firstFocusRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border px-2 py-1 text-sm hover:bg-accent"
          >
            Close
          </button>
        </div>

        {!template ? (
          <div className="space-y-3">
            {CLIENT_CAMPAIGN_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTemplate(t)}
                className="w-full rounded-md border p-4 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="font-medium">{t.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {t.description}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {t.positive_keyword_count} positive / {t.negative_keyword_count}{" "}
                  negative keywords · {t.headline_count} headlines ·{" "}
                  {t.description_count} descriptions · default{" "}
                  {formatMicrosAsUsd(t.default_daily_budget_micros)}/day
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm">
              <span className="font-medium">Template:</span> {template.name}{" "}
              <button
                type="button"
                onClick={() => setTemplate(null)}
                className="text-xs text-primary hover:underline"
              >
                change
              </button>
            </div>

            <label className="block">
              <span className="text-sm font-medium">Campaign name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={300}
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Daily budget (USD)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                value={dollars}
                onChange={(e) => setDollars(e.target.value)}
                className="mt-1 w-40 rounded-md border bg-background p-2 text-sm"
              />
              <span className="ml-2 text-xs text-muted-foreground">
                Cap: {formatMicrosAsUsd(maxDailyMicros)} / day
              </span>
            </label>

            {missing && missing.length > 0 && (
              <div role="alert" className="rounded-md border border-amber-700/40 bg-amber-100/10 p-3 text-sm">
                <div className="font-medium">Shop is missing required fields</div>
                <div className="mt-1 text-muted-foreground">
                  {missing.join(", ")} — complete these in shop settings before
                  creating a campaign.
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={onSubmit} disabled={pending}>
                {pending ? "Creating…" : "Create campaign"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
