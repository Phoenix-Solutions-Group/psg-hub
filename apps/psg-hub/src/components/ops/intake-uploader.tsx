"use client";

// Track A / PSG-402 — Pilot-intake single-drop uploader (client).
//
// Lets the sole superadmin (Nick) drop his FileMaker RO/Estimate export straight
// into the private "pilot-intake" bucket without any console fetch:
//   1. POST /api/ops/intake/signed-upload { companySlug, shopSlug, fileName }
//      — the route runs server-side UNDER his superadmin session, mints a
//        single-use signed-upload token (service-role only), and returns
//        { path, signedUrl, token }.
//   2. Upload the file from the browser with the returned token via
//      supabase.storage.from('pilot-intake').uploadToSignedUrl(path, token, file).
//
// No secret is minted/relayed by an agent — the mint is Nick's own action, and the
// token never leaves this component (success renders only the object `path`; the
// token is never rendered or logged). The slug inputs are free-entry + validated
// because the pilot shop is not seeded as a `shops` row yet (no dropdown).
//
// The validation regexes MIRROR the authoritative server validator in
// lib/ops/intake/signed-upload.ts (buildIntakePath). Client validation is UX-only
// fast-fail; the route + bucket RLS remain the real gate.

import { useCallback, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The private bucket holding the raw pilot FileMaker RO/Estimate export. */
export const INTAKE_BUCKET = "pilot-intake";

// Mirror lib/ops/intake/signed-upload.ts. Kept local because that module is
// server-only (imports the service client); these are duplicated intentionally
// for client-side UX validation, not as the security boundary.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const MAX_SEGMENT = 100;

/** Validate a kebab-case slug. Returns an error message, or null when valid. */
export function validateSlug(label: string, value: string): string | null {
  if (value.length === 0) return `${label} is required`;
  if (value.length > MAX_SEGMENT || !SLUG_RE.test(value)) {
    return `${label} must be a lowercase kebab-case slug`;
  }
  return null;
}

/** Validate the (file-derived) object file name. Returns an error message, or null. */
export function validateFileName(value: string): string | null {
  if (value.length === 0) return "A file is required";
  if (value.length > MAX_SEGMENT) return "File name is too long";
  if (value.includes("..") || !FILE_NAME_RE.test(value)) {
    return "File name must be a single safe segment (letters, digits, dot, dash, underscore — no spaces). Rename the file and retry.";
  }
  return null;
}

export type MintResult =
  | { ok: true; path: string; signedUrl: string; token: string }
  | { ok: false; message: string };

/**
 * Map the signed-upload route response to a typed result. A 200 with the full
 * triple is the only success; everything else surfaces the route's own error
 * message (400 validation / 500 storage) or a status-code fallback. Pure.
 */
export function parseMintResponse(status: number, body: unknown): MintResult {
  const b = (body ?? {}) as Record<string, unknown>;
  if (
    status === 200 &&
    typeof b.path === "string" &&
    typeof b.signedUrl === "string" &&
    typeof b.token === "string"
  ) {
    return { ok: true, path: b.path, signedUrl: b.signedUrl, token: b.token };
  }
  const message =
    typeof b.error === "string" && b.error.length > 0
      ? b.error
      : `Upload could not start (HTTP ${status}).`;
  return { ok: false, message };
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; path: string }
  | { kind: "error"; message: string };

type IntakeUploaderProps = {
  defaultCompanySlug?: string;
  defaultShopSlug?: string;
};

export function IntakeUploader({
  defaultCompanySlug = "collision-leaders",
  defaultShopSlug = "shelton-collision",
}: IntakeUploaderProps) {
  const [companySlug, setCompanySlug] = useState(defaultCompanySlug);
  const [shopSlug, setShopSlug] = useState(defaultShopSlug);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const validationError = useMemo(() => {
    const company = validateSlug("Company slug", companySlug);
    if (company) return company;
    const shop = validateSlug("Shop slug", shopSlug);
    if (shop) return shop;
    if (!file) return null; // not an error yet — submit is just disabled
    return validateFileName(file.name);
  }, [companySlug, shopSlug, file]);

  const uploading = phase.kind === "uploading";
  const canSubmit = !uploading && !!file && !validationError;

  const pickFile = useCallback((f: File | null) => {
    setFile(f);
    setPhase({ kind: "idle" });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0] ?? null;
      if (f) pickFile(f);
    },
    [pickFile],
  );

  const handleSubmit = useCallback(async () => {
    if (!file) return;
    const fileError = validateFileName(file.name);
    if (fileError) {
      setPhase({ kind: "error", message: fileError });
      return;
    }
    setPhase({ kind: "uploading" });

    let res: Response;
    try {
      res = await fetch("/api/ops/intake/signed-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only metadata + the file NAME crosses here — never the file contents.
        body: JSON.stringify({ companySlug, shopSlug, fileName: file.name }),
      });
    } catch {
      setPhase({ kind: "error", message: "Network error reaching the mint endpoint." });
      return;
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* leave body null → parseMintResponse falls back to a status message */
    }

    const minted = parseMintResponse(res.status, body);
    if (!minted.ok) {
      setPhase({ kind: "error", message: minted.message });
      return;
    }

    // Upload straight from the browser with the single-use token. The token is
    // used here and then discarded — it is never stored in state we render.
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(INTAKE_BUCKET)
      .uploadToSignedUrl(minted.path, minted.token, file);
    if (error) {
      setPhase({ kind: "error", message: `Upload failed: ${error.message}` });
      return;
    }

    setPhase({ kind: "success", path: minted.path });
  }, [file, companySlug, shopSlug]);

  return (
    <div className="max-w-xl space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="intake-company-slug">Company slug</Label>
          <Input
            id="intake-company-slug"
            value={companySlug}
            onChange={(e) => setCompanySlug(e.target.value.trim())}
            disabled={uploading}
            spellCheck={false}
            autoCapitalize="none"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="intake-shop-slug">Shop slug</Label>
          <Input
            id="intake-shop-slug"
            value={shopSlug}
            onChange={(e) => setShopSlug(e.target.value.trim())}
            disabled={uploading}
            spellCheck={false}
            autoCapitalize="none"
          />
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Choose or drop a file to upload"
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border px-6 py-8 text-center transition-colors",
          dragOver && "border-ember bg-ember/5",
          uploading && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <p className="font-heading text-sm font-medium">{file.name}</p>
        ) : (
          <p className="font-heading text-sm font-medium text-muted-foreground">
            Drag &amp; drop the FileMaker export here, or click to choose a file
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          One file → <code>pilot-intake/{companySlug || "{company}"}/{shopSlug || "{shop}"}/&lt;file&gt;</code>
        </p>
      </div>

      {validationError && file ? (
        <p className="text-sm text-destructive">{validationError}</p>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={cn(buttonVariants({ variant: "default" }), "w-full")}
      >
        {uploading ? "Uploading…" : "Upload to pilot-intake"}
      </button>

      {phase.kind === "success" ? (
        <div className="rounded-md border border-border bg-muted/40 p-4">
          <p className="font-heading text-sm font-semibold text-foreground">Upload complete</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The export landed at <code className="break-all">{phase.path}</code> in the private
            pilot-intake bucket.
          </p>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-heading text-sm font-semibold text-destructive">Upload failed</p>
          <p className="mt-1 text-sm text-muted-foreground">{phase.message}</p>
        </div>
      ) : null}
    </div>
  );
}
