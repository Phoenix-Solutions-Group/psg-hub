"use client";

// v1.1 / PSG-37 — generic master-data CRUD UI for the System Configuration
// verticals. Config-driven (config.ts) so one component serves all five
// resources: list + create + inline edit + delete. Mutations hit the hand-written
// per-entity routes at /api/sys-config/<slug>[/<id>], then router.refresh() so the
// server component stays the source of truth.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EntityConfig, FieldSpec, ListColumn } from "./config";

export type OptionItem = { id: string; label: string };
type Row = Record<string, unknown> & { id: string };
type FormValues = Record<string, unknown>;

export type ResourceManagerProps = {
  entity: EntityConfig;
  rows: Row[];
  /** Options for multiselect fields, keyed by the field's `optionsFrom` slug. */
  options: Record<string, OptionItem[]>;
};

function emptyForm(fields: FieldSpec[]): FormValues {
  const v: FormValues = {};
  for (const f of fields) v[f.key] = f.type === "multiselect" ? [] : "";
  return v;
}

/** Seed the form from an existing row (for edit). */
function formFromRow(fields: FieldSpec[], row: Row): FormValues {
  const v: FormValues = {};
  for (const f of fields) {
    const raw = row[f.key];
    if (f.type === "multiselect") {
      v[f.key] = Array.isArray(raw) ? (raw as string[]) : [];
    } else if (f.type === "money") {
      v[f.key] = typeof raw === "number" ? (raw / 100).toString() : "";
    } else if (f.type === "json") {
      v[f.key] = raw == null ? "" : JSON.stringify(raw, null, 2);
    } else {
      v[f.key] = raw == null ? "" : String(raw);
    }
  }
  return v;
}

/** Build the JSON payload from form values, or throw a user-facing error. */
function buildPayload(fields: FieldSpec[], values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key];
    switch (f.type) {
      case "money": {
        const s = String(raw ?? "").trim();
        const cents = s === "" ? 0 : Math.round(parseFloat(s) * 100);
        if (Number.isNaN(cents)) throw new Error(`${f.label} must be a number`);
        payload[f.key] = cents;
        break;
      }
      case "json": {
        const s = String(raw ?? "").trim();
        if (s === "") {
          payload[f.key] = f.jsonShape === "array" ? [] : {};
        } else {
          try {
            payload[f.key] = JSON.parse(s);
          } catch {
            throw new Error(`${f.label} is not valid JSON`);
          }
        }
        break;
      }
      case "multiselect":
        payload[f.key] = Array.isArray(raw) ? raw : [];
        break;
      default: {
        const s = String(raw ?? "").trim();
        if (f.required && s === "") throw new Error(`${f.label} is required`);
        payload[f.key] = s === "" ? (f.required ? "" : null) : s;
      }
    }
  }
  return payload;
}

function formatCell(col: ListColumn, value: unknown): string {
  if (value == null || value === "") return "—";
  if (col.type === "money" && typeof value === "number") return `$${(value / 100).toFixed(2)}`;
  return String(value);
}

export function ResourceManager({ entity, rows, options }: ResourceManagerProps) {
  const router = useRouter();
  const { slug, singular, fields, listColumns } = entity;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FormValues>(() => emptyForm(fields));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startCreate() {
    setEditingId(null);
    setValues(emptyForm(fields));
    setError(null);
    setCreating(true);
  }

  function startEdit(row: Row) {
    setCreating(false);
    setEditingId(row.id);
    setValues(formFromRow(fields, row));
    setError(null);
  }

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  function setField(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let payload: Record<string, unknown>;
    try {
      payload = buildPayload(fields, values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid input");
      return;
    }
    setBusy(true);
    try {
      const url = editingId ? `/api/sys-config/${slug}/${editingId}` : `/api/sys-config/${slug}`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      cancel();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`Delete this ${singular.toLowerCase()}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sys-config/${slug}/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      if (editingId === row.id) cancel();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  const formOpen = creating || editingId !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} on file</p>
        {!formOpen && (
          <Button type="button" onClick={startCreate}>
            + New {singular.toLowerCase()}
          </Button>
        )}
      </div>

      {formOpen && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="font-heading text-sm font-semibold">
            {editingId ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={values[f.key]}
                options={f.optionsFrom ? options[f.optionsFrom] ?? [] : []}
                onChange={(v) => setField(f.key, v)}
              />
            ))}
          </div>
          {error && <p className="text-sm text-ember">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!formOpen && error && <p className="text-sm text-ember">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {listColumns.map((c) => (
                <th key={c.key} className="px-4 py-3">
                  {c.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={listColumns.length + 1}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No {singular.toLowerCase()} records yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  {listColumns.map((c) => (
                    <td key={c.key} className="px-4 py-2.5">
                      {formatCell(c, row[c.key])}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="font-medium text-muted-foreground hover:text-ember disabled:opacity-50"
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        className="font-medium text-muted-foreground hover:text-ember disabled:opacity-50"
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  options,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  options: OptionItem[];
  onChange: (v: unknown) => void;
}) {
  const label = (
    <Label className="text-xs font-medium text-muted-foreground">
      {field.label}
      {field.required ? " *" : ""}
    </Label>
  );

  if (field.type === "textarea" || field.type === "json") {
    const placeholder = field.type === "json" ? (field.jsonShape === "array" ? "[]" : "{}") : undefined;
    return (
      <label className="space-y-1.5 sm:col-span-2">
        {label}
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={field.type === "json" ? 4 : 3}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
    );
  }

  if (field.type === "multiselect") {
    const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <div className="space-y-1.5 sm:col-span-2">
        {label}
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-input p-2">
          {options.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground">No options available.</p>
          ) : (
            options.map((opt) => (
              <label key={opt.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(opt.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(opt.id);
                    else next.delete(opt.id);
                    onChange([...next]);
                  }}
                />
                {opt.label}
              </label>
            ))
          )}
        </div>
      </div>
    );
  }

  if (field.type === "money") {
    return (
      <label className="space-y-1.5">
        {label}
        <Input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
        />
      </label>
    );
  }

  // text
  return (
    <label className="space-y-1.5">
      {label}
      <Input
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
        maxLength={field.max}
      />
    </label>
  );
}
