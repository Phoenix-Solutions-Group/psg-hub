"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponseModal,
  type ExistingResponse,
} from "@/components/dashboard/response-modal";

type Review = {
  id: string;
  shop_id: string;
  platform: string;
  author: string | null;
  rating: number;
  body: string | null;
  posted_at: string | null;
  url: string | null;
};

type Shop = { id: string; name: string };
type ShopRole = "owner" | "manager" | "viewer";

type Props = {
  reviews: Review[];
  shops: Shop[];
  responsesByReviewId: Record<string, ExistingResponse>;
  rolesByShopId: Record<string, ShopRole>;
};

const platformLabels: Record<string, string> = {
  google: "Google",
  yelp: "Yelp",
  facebook: "Facebook",
  carwise: "Carwise",
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Stars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span aria-label={`${value} out of 5 stars`} className="text-primary">
      {"★".repeat(rounded)}
      <span className="text-muted-foreground">{"★".repeat(5 - rounded)}</span>
    </span>
  );
}

function truncate(s: string | null, n = 120) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

function responseLabel(r: ExistingResponse | undefined) {
  if (!r) return "None";
  if (r.status === "approved") return "Approved";
  if (r.status === "rejected") return "Rejected";
  return `Draft v${r.version}`;
}

export function ReviewsTable({
  reviews,
  shops,
  responsesByReviewId: initialResponses,
  rolesByShopId,
}: Props) {
  const [shopId, setShopId] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [responses, setResponses] =
    useState<Record<string, ExistingResponse>>(initialResponses);
  const [activeReview, setActiveReview] = useState<Review | null>(null);

  const filtered = reviews.filter((r) => {
    if (shopId && r.shop_id !== shopId) return false;
    if (platform && r.platform !== platform) return false;
    return true;
  });

  async function handleSync() {
    const target = shopId || shops[0]?.id;
    if (!target) {
      setSyncMessage("Select a shop first");
      return;
    }
    setSyncMessage(null);
    startTransition(async () => {
      const res = await fetch("/api/reviews/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncMessage(data.error || "Sync failed");
        return;
      }
      setSyncMessage(
        `Synced: ${data.inserted} new, ${data.skipped} unchanged` +
          (data.errors?.length ? ` (${data.errors.length} platform errors)` : "")
      );
    });
  }

  const activeRole = activeReview
    ? rolesByShopId[activeReview.shop_id] ?? "viewer"
    : "viewer";
  const activeExisting = activeReview ? responses[activeReview.id] ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {shops.length > 1 && (
          <select
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">All shops</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All platforms</option>
          <option value="google">Google</option>
          <option value="yelp">Yelp</option>
        </select>
        <button
          type="button"
          onClick={handleSync}
          disabled={pending}
          className="rounded-md border bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {pending ? "Syncing…" : "Sync now"}
        </button>
        {syncMessage && (
          <span className="text-sm text-muted-foreground">{syncMessage}</span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
          No reviews yet. Connect Google or Yelp from shop settings, then use
          Sync now.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Author</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Response</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const existing = responses[r.id];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.author || "—"}
                  </TableCell>
                  <TableCell>
                    <Stars value={r.rating} />
                  </TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    {truncate(r.body)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {platformLabels[r.platform] ?? r.platform}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(r.posted_at)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveReview(r)}
                    >
                      {responseLabel(existing)}
                    </Button>
                  </TableCell>
                  <TableCell>
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        View on Google
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {activeReview && (
        <ResponseModal
          review={{
            id: activeReview.id,
            author: activeReview.author,
            rating: activeReview.rating,
            body: activeReview.body,
            platform: activeReview.platform,
          }}
          userRole={activeRole}
          existing={activeExisting}
          onClose={() => setActiveReview(null)}
          onSaved={(next) =>
            setResponses((prev) => ({ ...prev, [next.id]: next }))
          }
        />
      )}
    </div>
  );
}
