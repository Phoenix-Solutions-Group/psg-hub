// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseModal } from "@/components/dashboard/response-modal";

describe("ResponseModal comment disclosure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  it("collapses and restores comments without changing their content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          comments: [
            {
              id: "comment-1",
              body: "Keep this exact team note.",
              author_name: "Alex",
              created_at: "2026-08-20T12:00:00.000Z",
            },
          ],
        }),
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        <ResponseModal
          review={{
            id: "review-1",
            author: "Taylor",
            rating: 5,
            body: "Great work",
            platform: "google",
          }}
          userRole="manager"
          existing={null}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Keep this exact team note.");
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-controls="team-comments-content"]',
    );
    const content = container.querySelector<HTMLElement>(
      "#team-comments-content",
    );

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(content?.hidden).toBe(false);
    flushSync(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.textContent).toContain("Expand comments");
    expect(content?.hidden).toBe(true);
    flushSync(() => toggle?.click());
    expect(content?.hidden).toBe(false);
    expect(content?.textContent).toContain("Keep this exact team note.");

    flushSync(() => root.unmount());
  });
});
