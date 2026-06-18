"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Manual CSI survey entry (v1.1 / PSG-36). POSTs to the manage_reports-gated
// /api/surveys route, then refreshes the server list. EMI is entered as a
// percentage (0..100); the API persists it as the 0..1 fraction the
// network_summary / shop_detail functions expect.

const SCORE_FIELDS = [
  { key: "quality", label: "Quality" },
  { key: "cleanliness", label: "Cleanliness" },
  { key: "communication", label: "Communication" },
  { key: "courtesy", label: "Courtesy" },
] as const;

type ScoreKey = (typeof SCORE_FIELDS)[number]["key"];

const todayISO = () => new Date().toISOString().slice(0, 10);

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function NewSurveyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shopName, setShopName] = useState("");
  const [surveyDate, setSurveyDate] = useState(todayISO());
  const [emiPct, setEmiPct] = useState("");
  const [scores, setScores] = useState<Record<ScoreKey, string>>({
    quality: "",
    cleanliness: "",
    communication: "",
    courtesy: "",
  });
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setShopName("");
    setSurveyDate(todayISO());
    setEmiPct("");
    setScores({ quality: "", cleanliness: "", communication: "", courtesy: "" });
    setComments("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_name: shopName.trim(),
          survey_date: surveyDate,
          emi_pct: numOrNull(emiPct),
          quality: numOrNull(scores.quality),
          cleanliness: numOrNull(scores.cleanliness),
          communication: numOrNull(scores.communication),
          courtesy: numOrNull(scores.courtesy),
          customer_comments: comments.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record survey");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + Record survey
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="survey-shop">Shop name</Label>
          <Input
            id="survey-shop"
            placeholder="Shop name"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="survey-date">Survey date</Label>
          <Input
            id="survey-date"
            type="date"
            value={surveyDate}
            onChange={(e) => setSurveyDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="survey-emi">EMI %</Label>
          <Input
            id="survey-emi"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.1"
            placeholder="0–100"
            value={emiPct}
            onChange={(e) => setEmiPct(e.target.value)}
          />
        </div>
        {SCORE_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`survey-${f.key}`}>{f.label}</Label>
            <Input
              id={`survey-${f.key}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={10}
              step="0.1"
              placeholder="0–10"
              value={scores[f.key]}
              onChange={(e) => setScores((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="survey-comments">Customer comments</Label>
        <textarea
          id="survey-comments"
          rows={3}
          placeholder="Optional verbatim customer feedback"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>

      {error && <p className="text-sm text-ember">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || !shopName.trim() || !surveyDate}>
          {submitting ? "Saving…" : "Save survey"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
