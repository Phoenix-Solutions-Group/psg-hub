// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseModal } from "@/components/dashboard/response-modal";

describe("ResponseModal", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    document.body.style.overflow = "";
  });

  it("keeps tall content scrollable and restores page state when closed", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    document.body.style.overflow = "clip";

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onClose = vi.fn();

    flushSync(() => {
      root?.render(
        <ResponseModal
          review={{
            id: "review-1",
            author: "Danielle Brooks",
            rating: 5,
            body: "Great service",
            platform: "Google",
          }}
          userRole="owner"
          existing={null}
          initialComments={[]}
          onClose={onClose}
          onSaved={vi.fn()}
          onCommentAdded={vi.fn()}
        />
      );
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog?.className).toContain("overflow-y-auto");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement?.textContent).toBe("Close");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();

    flushSync(() => root?.unmount());
    root = null;
    expect(document.body.style.overflow).toBe("clip");
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("collapses and restores team comments without changing their content", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ResponseModal
          review={{
            id: "review-1",
            author: "Danielle Brooks",
            rating: 5,
            body: "Great service",
            platform: "Google",
          }}
          userRole="owner"
          existing={null}
          initialComments={[
            {
              id: "comment-1",
              review_id: "review-1",
              response_id: null,
              body: "Keep this exact team note.",
              author_name: "Alex",
              created_at: "2026-08-20T12:00:00.000Z",
            },
          ]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onCommentAdded={vi.fn()}
        />
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-controls="response-team-comments"]'
    );
    const content = container.querySelector<HTMLElement>("#response-team-comments");

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(content?.hidden).toBe(false);
    expect(content?.textContent).toContain("Keep this exact team note.");

    flushSync(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.textContent).toContain("Expand comments");
    expect(content?.hidden).toBe(true);

    flushSync(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(content?.hidden).toBe(false);
    expect(content?.textContent).toContain("Keep this exact team note.");
  });
});
