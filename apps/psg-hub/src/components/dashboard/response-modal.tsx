"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ReviewResponseStatus = "draft" | "approved" | "rejected";
type ReviewResponseTone = "default" | "warm" | "concise" | "apologetic";

export type ExistingResponse = {
  id: string;
  body: string;
  status: ReviewResponseStatus;
  tone_preset: ReviewResponseTone;
  version: number;
  safety_flags: string[];
  safety_overridden: boolean;
  approved_at: string | null;
};

export type ReviewResponseComment = {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
};

type Review = {
  id: string;
  author: string | null;
  rating: number;
  body: string | null;
  platform: string;
};

type ShopRole = "owner" | "manager" | "viewer";

type Props = {
  review: Review;
  userRole: ShopRole;
  existing: ExistingResponse | null;
  onClose: () => void;
  onSaved: (response: ExistingResponse) => void;
};

const TONES: ReviewResponseTone[] = [
  "default",
  "warm",
  "concise",
  "apologetic",
];

const FLAG_LABELS: Record<string, string> = {
  phone_number: "Phone number",
  email_address: "Email address",
  url: "URL",
  admission_of_fault: "Admission of fault",
  insurance_promise: "Insurance promise",
  disparagement: "Disparaging language",
};

const CRITICAL_FLAGS = new Set([
  "admission_of_fault",
  "insurance_promise",
  "disparagement",
]);

export function ResponseModal({
  review,
  userRole,
  existing,
  onClose,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<ExistingResponse | null>(existing);
  const [editBody, setEditBody] = useState<string>(existing?.body ?? "");
  const [tone, setTone] = useState<ReviewResponseTone>(
    existing?.tone_preset ?? "default"
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [comments, setComments] = useState<ReviewResponseComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentMessage, setCommentMessage] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Capture opener for focus return + initial focus + ESC key.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstFocusableRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousBodyOverflow;
      openerRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reviews/${review.id}/comments`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load comments");
        if (!cancelled) setComments(data.comments as ReviewResponseComment[]);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCommentMessage(
            error instanceof Error ? error.message : "Failed to load comments"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [review.id]);

  // Focus trap
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const status = draft?.status ?? "draft";
  const flags = draft?.safety_flags ?? [];
  const overridden = draft?.safety_overridden ?? false;
  const isApproved = status === "approved";
  const hasCriticalFlag = flags.some((f) => CRITICAL_FLAGS.has(f));
  const canApprove = userRole === "owner" || userRole === "manager";
  const canOverride = userRole === "owner";
  const approveBlocked = hasCriticalFlag && !overridden;
  const expectedVersion = draft?.version ?? 0;

  async function callDraft() {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/reviews/${review.id}/draft-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          setMessage("Rate limit hit. Try again later.");
        } else if (res.status === 504) {
          setMessage("Request timed out. Try again.");
        } else {
          setMessage(data.error || `Draft failed (${res.status})`);
        }
        return;
      }
      setDraft(data.response as ExistingResponse);
      setEditBody((data.response as ExistingResponse).body);
      onSaved(data.response as ExistingResponse);
    });
  }

  async function callApprove(action: string, extraBody?: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/reviews/${review.id}/approve-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          body: extraBody,
          expectedVersion,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setMessage(
            data.error || "Response was changed by another user. Refresh."
          );
        } else if (res.status === 403) {
          setMessage(data.error || "Not permitted.");
        } else {
          setMessage(data.error || `Failed (${res.status})`);
        }
        return;
      }
      setDraft(data.response as ExistingResponse);
      setEditBody((data.response as ExistingResponse).body);
      onSaved(data.response as ExistingResponse);
    });
  }

  async function copyToClipboard() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Clipboard access denied.");
    }
  }

  async function addComment() {
    const body = commentBody.trim();
    if (!body) {
      setCommentMessage("Enter a comment before adding it.");
      return;
    }
    setCommentMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/reviews/${review.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, responseId: draft?.id ?? null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCommentMessage(data.error || "Failed to add comment");
        return;
      }
      setComments((current) => [
        ...current,
        data.comment as ReviewResponseComment,
      ]);
      setCommentBody("");
      setCommentMessage("Comment added for your team.");
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="response-modal-title"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-md border bg-background p-6 shadow-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="response-modal-title"
              className="text-lg font-semibold tracking-tight"
            >
              Draft response
            </h2>
            <p className="text-sm text-muted-foreground">
              {review.author || "Anonymous"} · {review.rating} / 5 ·{" "}
              {review.platform}
            </p>
          </div>
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border px-2 py-1 text-sm hover:bg-accent"
          >
            Close
          </button>
        </div>

        {review.body && (
          <div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            {review.body}
          </div>
        )}

        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="tone-select" className="text-sm font-medium">
            Tone
          </label>
          <select
            id="tone-select"
            value={tone}
            onChange={(e) => setTone(e.target.value as ReviewResponseTone)}
            disabled={isApproved}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Badge variant="secondary">
            {status}
            {draft ? ` · v${draft.version}` : ""}
          </Badge>
        </div>

        {flags.length > 0 && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-amber-700/40 bg-amber-100/10 p-3 text-sm"
          >
            <div className="mb-1 font-medium">Safety review needed</div>
            <ul className="list-inside list-disc text-muted-foreground">
              {flags.map((f) => (
                <li key={f}>{FLAG_LABELS[f] ?? f}</li>
              ))}
            </ul>
            {overridden && (
              <div className="mt-1 text-xs text-muted-foreground">
                Owner has overridden these flags.
              </div>
            )}
          </div>
        )}

        {!draft ? (
          <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No draft yet. Pick a tone and click Draft with AI.
          </div>
        ) : (
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            readOnly={isApproved}
            rows={6}
            className="w-full rounded-md border bg-background p-3 text-sm"
            aria-label="Response body"
          />
        )}

        {message && (
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        )}

        <section
          className="mt-4 rounded-md border p-3"
          aria-labelledby="team-comments-heading"
        >
          <h3 id="team-comments-heading" className="text-sm font-semibold">
            Team comments
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Internal only. Adding a comment does not approve, reject,
            regenerate, or publish this response.
          </p>
          <div className="mt-3 space-y-2" aria-live="polite">
            {commentsLoading ? (
              <p className="text-sm text-muted-foreground">Loading comments…</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No team comments yet.
              </p>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-md bg-muted/40 p-2 text-sm"
                >
                  <p className="whitespace-pre-wrap break-words">
                    {comment.body}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {comment.author_name} ·{" "}
                    {new Date(comment.created_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
          <label
            htmlFor="team-comment-body"
            className="mt-3 block text-sm font-medium"
          >
            Add comment
          </label>
          <textarea
            id="team-comment-body"
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            maxLength={2000}
            rows={3}
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {commentBody.length} / 2,000
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={addComment}
              disabled={pending || !commentBody.trim()}
            >
              {pending ? "Adding…" : "Add comment"}
            </Button>
          </div>
          {commentMessage && (
            <p className="mt-2 text-sm text-muted-foreground">
              {commentMessage}
            </p>
          )}
        </section>

        <div className="mt-4 flex flex-wrap gap-2">
          {!draft ? (
            <Button onClick={callDraft} disabled={pending}>
              {pending ? "Drafting…" : "Draft with AI"}
            </Button>
          ) : (
            <>
              {!isApproved && (
                <>
                  <Button
                    variant="outline"
                    onClick={callDraft}
                    disabled={pending}
                  >
                    {pending ? "Working…" : "Regenerate"}
                  </Button>
                  {editBody !== draft.body && (
                    <Button
                      variant="outline"
                      onClick={() => callApprove("update", editBody)}
                      disabled={pending}
                    >
                      Save edits
                    </Button>
                  )}
                  {canOverride && hasCriticalFlag && !overridden && (
                    <Button
                      variant="outline"
                      onClick={() => callApprove("override_safety")}
                      disabled={pending}
                    >
                      Override safety
                    </Button>
                  )}
                  {canApprove && (
                    <Button
                      onClick={() => callApprove("approve")}
                      disabled={pending || approveBlocked}
                      title={
                        approveBlocked
                          ? "Safety flags must be cleared or overridden"
                          : undefined
                      }
                    >
                      Approve
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => callApprove("reject")}
                    disabled={pending}
                  >
                    Reject
                  </Button>
                </>
              )}
              {isApproved && (
                <>
                  <Button onClick={copyToClipboard} disabled={pending}>
                    {copied ? "Copied" : "Copy to clipboard"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => callApprove("unapprove")}
                    disabled={pending}
                  >
                    Un-approve
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
