"use client";

import { FileUp, Link, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BSM_CONTENT_APPROVALS_BUCKET,
  MAX_APPROVAL_FILE_BYTES,
  SUPPORTED_APPROVAL_FILE_TYPES,
  type BsmContentApprovalListItem,
} from "@/lib/bsm/content-approvals-shared";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type UploadResponse =
  | {
      item: BsmContentApprovalListItem;
      upload: { path: string; token: string; signedUrl: string; bucket: string };
    }
  | {
      item: BsmContentApprovalListItem;
    }
  | { error?: string };

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type BsmContentApprovalShopOption = { id: string; name: string };

export function BsmContentApprovalManager({
  initialApprovals,
  shops,
  activeShopId,
}: {
  initialApprovals: BsmContentApprovalListItem[];
  shops?: BsmContentApprovalShopOption[];
  activeShopId?: string | null;
}) {
  const [approvals, setApprovals] = useState(initialApprovals);
  const orderedShops = shops ?? [];
  const initialShopId = orderedShops.some((shop) => shop.id === activeShopId)
    ? activeShopId ?? ""
    : orderedShops[0]?.id ?? "";
  const [shopId, setShopId] = useState(initialShopId);
  const [customerProfileId, setCustomerProfileId] = useState("");
  const [title, setTitle] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<"uploaded_file" | "generated_page">("uploaded_file");
  const [generatedPagePath, setGeneratedPagePath] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [sourceContentItemId, setSourceContentItemId] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  const validationError = useMemo(() => {
    if (!shopId.trim()) return "Shop ID is required.";
    if (!title.trim()) return "Title is required.";
    if (!contextNote.trim()) return "Context note is required.";
    if (sourceKind === "generated_page") {
      if (!generatedPagePath.trim()) return "Generated page path is required.";
      if (previewUrl.trim()) {
        try {
          const url = new URL(previewUrl.trim());
          if (url.protocol !== "https:" && url.protocol !== "http:") return "Preview URL must be a web URL.";
        } catch {
          return "Preview URL must be a valid URL.";
        }
      }
      return null;
    }
    if (!file) return null;
    if (!(file.type in SUPPORTED_APPROVAL_FILE_TYPES)) {
      return "This file type is not supported. Upload a PDF, image, Word document, or text file.";
    }
    if (file.size <= 0) return "The selected file is empty.";
    if (file.size > MAX_APPROVAL_FILE_BYTES) return "The file is too large. Upload a file under 25 MB.";
    return null;
  }, [shopId, title, contextNote, sourceKind, generatedPagePath, previewUrl, file]);

  const uploading = phase.kind === "uploading";
  const canSubmit =
    !uploading &&
    !validationError &&
    (sourceKind === "generated_page" ? Boolean(generatedPagePath.trim()) : Boolean(file));

  async function startReviewItem() {
    if (validationError || (sourceKind === "uploaded_file" && !file)) {
      setPhase({
        kind: "error",
        message: validationError ?? "Choose a file before uploading.",
      });
      return;
    }
    setPhase({ kind: "uploading" });

    let response: Response;
    try {
      response = await fetch("/api/ops/bsm/content-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: shopId.trim(),
          customerProfileId: customerProfileId.trim() || null,
          title: title.trim(),
          contextNote: contextNote.trim(),
          sourceKind,
          ...(sourceKind === "generated_page"
            ? {
                generatedPagePath: generatedPagePath.trim(),
                previewUrl: previewUrl.trim() || null,
                sourceContentItemId: sourceContentItemId.trim() || null,
              }
            : {
                fileName: file?.name,
                contentType: file?.type,
                byteSize: file?.size,
              }),
        }),
      });
    } catch {
      setPhase({ kind: "error", message: "The upload service could not be reached." });
      return;
    }

    let body: UploadResponse = {};
    try {
      body = (await response.json()) as UploadResponse;
    } catch {
      body = {};
    }
    if (!response.ok || !("item" in body)) {
      setPhase({
        kind: "error",
        message: "error" in body && body.error ? body.error : "The review item could not be created.",
      });
      return;
    }

    if ("upload" in body) {
      if (!file) {
        setPhase({ kind: "error", message: "Choose a file before uploading." });
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(BSM_CONTENT_APPROVALS_BUCKET)
        .uploadToSignedUrl(body.upload.path, body.upload.token, file);
      if (error) {
        setPhase({ kind: "error", message: `Upload failed: ${error.message}` });
        return;
      }
    }

    setApprovals((current) => [body.item, ...current]);
    setTitle("");
    setContextNote("");
    setCustomerProfileId("");
    setFile(null);
    setGeneratedPagePath("");
    setPreviewUrl("");
    setSourceContentItemId("");
    if (fileRef.current) fileRef.current.value = "";
    setPhase({ kind: "success", message: "The item is in the customer review library." });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 border-b border-border pb-8">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bsm-approval-shop">Shop</Label>
            {orderedShops.length > 0 ? (
              <select
                id="bsm-approval-shop"
                value={shopId}
                onChange={(event) => setShopId(event.target.value)}
                disabled={uploading}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {orderedShops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name || shop.id}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="bsm-approval-shop"
                value={shopId}
                onChange={(event) => setShopId(event.target.value)}
                disabled={uploading}
                placeholder="No shops available"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bsm-approval-profile">Customer profile ID</Label>
            <Input
              id="bsm-approval-profile"
              value={customerProfileId}
              onChange={(event) => setCustomerProfileId(event.target.value)}
              disabled={uploading}
              placeholder="Optional reviewer profile"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bsm-approval-title">Review title</Label>
          <Input
            id="bsm-approval-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={uploading}
            maxLength={160}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bsm-approval-context">Context note for the customer</Label>
          <textarea
            id="bsm-approval-context"
            value={contextNote}
            onChange={(event) => setContextNote(event.target.value)}
            disabled={uploading}
            maxLength={3000}
            className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="inline-flex rounded-md border border-border p-1">
          <button
            type="button"
            className={cn(
              "rounded px-3 py-1.5 text-sm",
              sourceKind === "uploaded_file" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            onClick={() => {
              setSourceKind("uploaded_file");
              setPhase({ kind: "idle" });
            }}
            disabled={uploading}
          >
            File
          </button>
          <button
            type="button"
            className={cn(
              "rounded px-3 py-1.5 text-sm",
              sourceKind === "generated_page" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            onClick={() => {
              setSourceKind("generated_page");
              setPhase({ kind: "idle" });
            }}
            disabled={uploading}
          >
            Generated page
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
          {sourceKind === "generated_page" ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="bsm-approval-generated-path">Generated page path</Label>
                <Input
                  id="bsm-approval-generated-path"
                  value={generatedPagePath}
                  onChange={(event) => setGeneratedPagePath(event.target.value)}
                  disabled={uploading}
                  placeholder="/generated/wallace/july-offer"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bsm-approval-preview-url">Preview URL</Label>
                <Input
                  id="bsm-approval-preview-url"
                  value={previewUrl}
                  onChange={(event) => setPreviewUrl(event.target.value)}
                  disabled={uploading}
                  placeholder="Optional web preview"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bsm-approval-source-content">Source content ID</Label>
                <Input
                  id="bsm-approval-source-content"
                  value={sourceContentItemId}
                  onChange={(event) => setSourceContentItemId(event.target.value)}
                  disabled={uploading}
                  placeholder="Optional content item"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="bsm-approval-file">File</Label>
              <Input
                ref={fileRef}
                id="bsm-approval-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                disabled={uploading}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPhase({ kind: "idle" });
                }}
              />
            </div>
          )}
          <button
            type="button"
            onClick={startReviewItem}
            disabled={!canSubmit}
            className={cn(buttonVariants({ variant: "default" }), "gap-2")}
          >
            {uploading ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : sourceKind === "generated_page" ? (
              <Link className="size-4" aria-hidden="true" />
            ) : (
              <FileUp className="size-4" aria-hidden="true" />
            )}
            {uploading ? "Saving" : sourceKind === "generated_page" ? "Attach" : "Upload"}
          </button>
        </div>
        {validationError && (file || sourceKind === "generated_page") ? (
          <p className="text-sm text-destructive">{validationError}</p>
        ) : null}
        {phase.kind === "success" ? (
          <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success-foreground">
            {phase.message}
          </p>
        ) : null}
        {phase.kind === "error" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {phase.message}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Review library</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {approvals.length} review {approvals.length === 1 ? "item" : "items"}
            </p>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Feedback</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No review files yet.
                  </td>
                </tr>
              ) : (
                approvals.map((item) => (
                  <tr key={item.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.title}</div>
                      <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                        {item.contextNote}
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {item.status.replaceAll("_", " ")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.sourceKind === "generated_page"
                        ? "Generated page"
                        : item.currentVersion?.originalFilename ?? "No file"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div>{item.commentCount} comments</div>
                      <div className="mt-1">
                        {item.latestDecision
                          ? `${item.latestDecision.decision.replaceAll("_", " ")}`
                          : "No decision yet"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(item.updatedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
