"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ProductOption = {
  id: string;
  name: string;
  selling_price_cents: number;
};

export type Customizations = {
  logo?: string;
  header?: string;
  footer?: string;
  greeting?: string;
};

export type CompanyProgram = {
  id: string;
  quantity: number;
  unit_price_cents: number;
  customizations: Customizations;
  product: { id: string; name: string; selling_price_cents: number } | null;
};

function dollars(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// Per-company product enrollment + overrides (v1.1 / PSG-33). Talks to
// /api/companies/[id]/programs (+ /[programId]); all manage_companies-gated.
export function ProgramsManager({
  companyId,
  initialPrograms,
  availableProducts,
}: {
  companyId: string;
  initialPrograms: CompanyProgram[];
  availableProducts: ProductOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Enroll form
  const [productId, setProductId] = useState("");
  const [enrollQty, setEnrollQty] = useState("1");

  // Inline override editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("0");
  const [custom, setCustom] = useState<Customizations>({});

  async function enroll(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) return;
    setError(null);
    setBusy(true);
    try {
      const product = availableProducts.find((p) => p.id === productId);
      const res = await fetch(`/api/companies/${companyId}/programs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          quantity: Math.max(0, parseInt(enrollQty, 10) || 0),
          unit_price_cents: product?.selling_price_cents ?? 0,
          customizations_jsonb: {},
        }),
      });
      if (!res.ok) throw new Error(await errText(res));
      setProductId("");
      setEnrollQty("1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enroll product");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: CompanyProgram) {
    setEditingId(p.id);
    setQty(String(p.quantity));
    setPrice((p.unit_price_cents / 100).toFixed(2));
    setCustom(p.customizations ?? {});
    setError(null);
  }

  async function saveEdit(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/programs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: Math.max(0, parseInt(qty, 10) || 0),
          unit_price_cents: Math.max(0, Math.round((parseFloat(price) || 0) * 100)),
          customizations_jsonb: stripEmpty(custom),
        }),
      });
      if (!res.ok) throw new Error(await errText(res));
      setEditingId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save program");
    } finally {
      setBusy(false);
    }
  }

  async function unenroll(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/programs/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await errText(res));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unenroll");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-ember">{error}</p>}

      <form
        onSubmit={enroll}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4"
      >
        <label className="flex-1 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Enroll product</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            disabled={availableProducts.length === 0}
          >
            <option value="">
              {availableProducts.length === 0
                ? "All products enrolled"
                : "Select a product…"}
            </option>
            {availableProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {dollars(p.selling_price_cents)}
              </option>
            ))}
          </select>
        </label>
        <label className="w-24 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Qty</span>
          <Input
            type="number"
            min={0}
            value={enrollQty}
            onChange={(e) => setEnrollQty(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy || !productId}>
          {busy ? "…" : "Enroll"}
        </Button>
      </form>

      {initialPrograms.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No programs enrolled yet.
        </div>
      ) : (
        <div className="space-y-3">
          {initialPrograms.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-heading text-sm font-semibold">
                    {p.product?.name ?? "(product removed)"}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Qty {p.quantity} · {dollars(p.unit_price_cents)} each
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => (editingId === p.id ? setEditingId(null) : startEdit(p))}
                  >
                    {editingId === p.id ? "Close" : "Edit"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => unenroll(p.id)}
                    disabled={busy}
                  >
                    Unenroll
                  </Button>
                </div>
              </div>

              {editingId === p.id ? (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Quantity</span>
                      <Input
                        type="number"
                        min={0}
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Unit price (USD)
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </label>
                  </div>

                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Overrides
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Logo URL</span>
                      <Input
                        value={custom.logo ?? ""}
                        onChange={(e) => setCustom({ ...custom, logo: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Greeting</span>
                      <Input
                        value={custom.greeting ?? ""}
                        onChange={(e) => setCustom({ ...custom, greeting: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Header</span>
                      <Input
                        value={custom.header ?? ""}
                        onChange={(e) => setCustom({ ...custom, header: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Footer</span>
                      <Input
                        value={custom.footer ?? ""}
                        onChange={(e) => setCustom({ ...custom, footer: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" onClick={() => saveEdit(p.id)} disabled={busy}>
                      {busy ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                hasOverrides(p.customizations) && (
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    {p.customizations.logo && <span>Logo set</span>}
                    {p.customizations.greeting && <span>Greeting: “{p.customizations.greeting}”</span>}
                    {p.customizations.header && <span>Header set</span>}
                    {p.customizations.footer && <span>Footer set</span>}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hasOverrides(c: Customizations): boolean {
  return Boolean(c.logo || c.header || c.footer || c.greeting);
}

function stripEmpty(c: Customizations): Customizations {
  const out: Customizations = {};
  for (const k of ["logo", "header", "footer", "greeting"] as const) {
    const v = c[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

async function errText(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status})`;
}
