"use client";

// v1.1 / PSG-38 — RO/Estimate Import wizard.
// Upload -> auto/template mapping -> editable field map -> validated preview
// -> (optional save template) -> commit. Talks to /api/ops/import/*.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldsFor } from "@/lib/ops/import/fields";

type ImportKind = "ro" | "estimate";

type Template = { id: string; name: string; kind: ImportKind; field_mapping_jsonb: Record<string, string> };

type ValidatedRow = {
  index: number;
  values: Record<string, string | number | boolean | null>;
  errors: string[];
  warnings: string[];
};

type Preview = {
  table: { format: string; headers: string[]; rowCount: number };
  mapping: Record<string, string>;
  suggested: Record<string, string>;
  validation: { kind: ImportKind; total: number; valid: number; invalid: number; rows: ValidatedRow[]; unmappedRequired: string[] };
};

type CommitResult = {
  total: number;
  inserted: number;
  skipped: number;
  failedRows: Array<{ index: number; error: string }>;
};

export function ImportWizard({
  companyId,
  initialKind = "ro",
}: {
  companyId: string;
  initialKind?: ImportKind;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [commit, setCommit] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");

  const fields = useMemo(() => fieldsFor(kind), [kind]);

  const loadTemplates = useCallback(
    async (k: ImportKind) => {
      const res = await fetch(`/api/ops/import/templates?company_id=${companyId}&kind=${k}`);
      if (res.ok) {
        const data = (await res.json()) as { templates: Template[] };
        setTemplates(data.templates);
      }
    },
    [companyId],
  );

  // Lazy-load templates once a kind is active.
  useMemo(() => {
    void loadTemplates(kind);
  }, [kind, loadTemplates]);

  async function runValidate(useMapping?: Record<string, string>) {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setCommit(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", kind);
      if (useMapping) fd.set("mapping", JSON.stringify(useMapping));
      else if (templateId) fd.set("template_id", templateId);
      const res = await fetch("/api/ops/import/validate", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Validate failed (${res.status})`);
      const p = data as Preview;
      setPreview(p);
      setMapping(p.mapping);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validate failed");
    } finally {
      setBusy(false);
    }
  }

  function updateMapping(fieldKey: string, header: string) {
    setMapping((m) => {
      const next = { ...m };
      if (header) next[fieldKey] = header;
      else delete next[fieldKey];
      return next;
    });
  }

  async function saveTemplate() {
    if (!saveName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/import/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, kind, name: saveName.trim(), field_mapping: mapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSaveName("");
      await loadTemplates(kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", kind);
      fd.set("company_id", companyId);
      fd.set("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/ops/import/commit", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Commit failed (${res.status})`);
      setCommit(data as CommitResult);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — kind + file */}
      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          1 · Source file
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="kind">Type</Label>
            <select
              id="kind"
              className="mt-1 block rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as ImportKind);
                setPreview(null);
                setTemplateId("");
              }}
            >
              <option value="ro">Repair Orders</option>
              <option value="estimate">Estimates</option>
            </select>
          </div>
          <div className="grow">
            <Label htmlFor="file">File (csv, txt, xlsx, xlsb, xls, xml)</Label>
            <Input
              id="file"
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xlsb,.xlsm,.xls,.xml"
              className="mt-1"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setCommit(null);
              }}
            />
          </div>
          {templates.length > 0 && (
            <div>
              <Label htmlFor="template">Template</Label>
              <select
                id="template"
                className="mt-1 block rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">Auto-detect columns</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button type="button" disabled={!file || busy} onClick={() => runValidate()}>
            {busy ? "Working…" : "Parse & validate"}
          </Button>
        </div>
      </section>

      {error && <p className="rounded-md border border-ember/40 bg-ember/5 p-3 text-sm text-ember">{error}</p>}

      {/* Step 2 — mapping + preview */}
      {preview && (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            2 · Field mapping
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <label className="text-sm">
                  {f.label}
                  {f.required && <span className="text-ember"> *</span>}
                </label>
                <select
                  className="w-48 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => updateMapping(f.key, e.target.value)}
                >
                  <option value="">— unmapped —</option>
                  {preview.table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={busy} onClick={() => runValidate(mapping)}>
              Re-validate with this mapping
            </Button>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Save mapping as template…"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="w-56"
              />
              <Button type="button" variant="outline" disabled={busy || !saveName.trim()} onClick={saveTemplate}>
                Save template
              </Button>
            </div>
          </div>

          {preview.validation.unmappedRequired.length > 0 && (
            <p className="text-sm text-ember">
              Required fields unmapped: {preview.validation.unmappedRequired.join(", ")}
            </p>
          )}

          <PreviewTable preview={preview} />

          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={busy || preview.validation.valid === 0 || preview.validation.unmappedRequired.length > 0}
              onClick={runCommit}
            >
              Commit {preview.validation.valid} valid {kind === "ro" ? "RO" : "estimate"}
              {preview.validation.valid === 1 ? "" : "s"}
            </Button>
            <span className="text-sm text-muted-foreground">
              {preview.validation.valid} valid · {preview.validation.invalid} with errors · {preview.table.rowCount} total
            </span>
          </div>
        </section>
      )}

      {/* Step 3 — commit result */}
      {commit && (
        <section className="space-y-2 rounded-lg border border-leaf/40 bg-leaf/5 p-4">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            3 · Result
          </h2>
          <p className="text-sm">
            Imported <strong>{commit.inserted}</strong> · skipped {commit.skipped} duplicates · {commit.failedRows.length} failed.
          </p>
          {commit.failedRows.length > 0 && (
            <ul className="list-inside list-disc text-sm text-ember">
              {commit.failedRows.slice(0, 10).map((r) => (
                <li key={r.index}>
                  Row {r.index}: {r.error}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function PreviewTable({ preview }: { preview: Preview }) {
  const fields = fieldsFor(preview.validation.kind);
  const mappedKeys = fields.filter((f) => preview.mapping[f.key]).map((f) => f.key);
  const rows = preview.validation.rows.slice(0, 50);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Status</th>
            {mappedKeys.map((k) => (
              <th key={k} className="px-3 py-2">
                {fields.find((f) => f.key === k)?.label ?? k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} className={r.errors.length ? "bg-ember/5" : undefined}>
              <td className="px-3 py-2 text-muted-foreground">{r.index}</td>
              <td className="px-3 py-2">
                {r.errors.length ? (
                  <span className="text-ember" title={r.errors.join("; ")}>
                    ✗ {r.errors[0]}
                  </span>
                ) : r.warnings.length ? (
                  <span className="text-amber-600" title={r.warnings.join("; ")}>
                    ⚠ ok
                  </span>
                ) : (
                  <span className="text-leaf">✓</span>
                )}
              </td>
              {mappedKeys.map((k) => (
                <td key={k} className="px-3 py-2">
                  {String(r.values[k] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.validation.rows.length > rows.length && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Showing first {rows.length} of {preview.validation.rows.length} rows.
        </p>
      )}
    </div>
  );
}
