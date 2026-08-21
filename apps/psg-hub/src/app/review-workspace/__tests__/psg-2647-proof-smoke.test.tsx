import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewerWorkspace } from "../reviewer-workspace";

const htmlDocId = "11111111-1111-4111-8111-111111111111";
const generatedDocId = "22222222-2222-4222-8222-222222222222";
const pdfDocId = "33333333-3333-4333-8333-333333333333";
const imageDocId = "44444444-4444-4444-8444-444444444444";

function workspace(comments: Array<{ id: string; reviewItemId: string; versionId: string; body: string; pinNumber: number; draftStatus: string }> = []) {
  return {
    project: { id: "project-1", title: "QA proof review", status: "active" },
    round: { id: "round-1", status: "active" },
    reviewer: { email: "reviewer@e2e.test", submittedAt: null, readOnly: false },
    documents: [
      {
        itemId: htmlDocId,
        versionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Uploaded HTML proof",
        processingStatus: "ready",
        sectionTitle: "Website",
        originalFilename: "uploaded-proof.html",
        contentType: "text/html",
        previewUrl: null,
        generatedPagePath: null,
        proofUrl: "https://storage.example/uploaded-proof.html",
        proofContent: null,
      },
      {
        itemId: generatedDocId,
        versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Generated page proof",
        processingStatus: "ready",
        sectionTitle: "Landing page",
        originalFilename: null,
        contentType: "generated_page",
        previewUrl: "https://preview.example/generated-proof",
        generatedPagePath: "/generated/internal-only-proof",
        proofUrl: "/generated/internal-only-proof",
        proofContent: null,
      },
      {
        itemId: pdfDocId,
        versionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        title: "PDF proof",
        processingStatus: "ready",
        sectionTitle: "Document",
        originalFilename: "proof.pdf",
        contentType: "application/pdf",
        previewUrl: null,
        generatedPagePath: null,
        proofUrl: "https://storage.example/proof.pdf",
        proofContent: null,
      },
      {
        itemId: imageDocId,
        versionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        title: "Image proof",
        processingStatus: "ready",
        sectionTitle: "Image",
        originalFilename: "proof.jpg",
        contentType: "image/jpeg",
        previewUrl: "https://storage.example/proof.jpg",
        generatedPagePath: null,
        proofUrl: "https://storage.example/proof.jpg",
        proofContent: null,
      },
    ],
    comments,
    decisions: [],
  };
}

describe("PSG-2647 reviewer proof smoke", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
      if (href.endsWith("/api/bsm/review-workspace/verify")) {
        return Response.json({ session: { sessionHash: "session-hash" } });
      }
      if (href.endsWith("/api/bsm/review-workspace/session")) {
        return Response.json({ workspace: workspace() });
      }
      if (href.endsWith("/api/bsm/review-workspace/comments")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { reviewItemId: string; versionId: string; body: string };
        return Response.json({
          ok: true,
          workspace: workspace([
            {
              id: "comment-1",
              reviewItemId: body.reviewItemId,
              versionId: body.versionId,
              body: body.body,
              pinNumber: 1,
              draftStatus: "draft",
            },
          ]),
        });
      }
      return Response.json({ error: "unexpected request" }, { status: 500 });
    }));
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lets reviewers choose proof screens and attaches comments to the selected proof", async () => {
    flushSync(() => {
      root.render(<ReviewerWorkspace inviteToken="invite-token" />);
    });

    const byText = (text: string) => {
      const element = [...container.querySelectorAll<HTMLElement>("*")].find((node) => node.textContent === text);
      if (!element) throw new Error(`Missing text: ${text}`);
      return element;
    };
    const byLabel = (text: string) => {
      const label = [...container.querySelectorAll<HTMLLabelElement>("label")].find((node) => node.textContent === text);
      const id = label?.getAttribute("for");
      const field = id ? container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`) : null;
      if (!field) throw new Error(`Missing label: ${text}`);
      return field;
    };
    const buttonByText = (text: string | RegExp) => {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) =>
        typeof text === "string" ? node.textContent?.includes(text) : text.test(node.textContent ?? ""),
      );
      if (!button) throw new Error(`Missing button: ${text.toString()}`);
      return button;
    };
    const change = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
      setter?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => expect(field.value).toBe(value));
    };
    const click = async (button: HTMLButtonElement) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    await change(byLabel("One-time code"), "123456");
    await vi.waitFor(() => expect(buttonByText("Open review").disabled).toBe(false));
    await click(buttonByText("Open review"));

    await vi.waitFor(() => expect(byText("QA proof review")).toBeTruthy());
    expect(byText("4 documents")).toBeTruthy();

    const reviewPanel = container.querySelector("aside");
    expect(reviewPanel).toBeTruthy();
    expect(reviewPanel?.className).toContain("xl:sticky");
    expect(reviewPanel?.className).toContain("xl:top-6");

    expect(container.querySelector<HTMLIFrameElement>('iframe[title="Uploaded HTML proof proof"]')?.getAttribute("src")).toBe(
      "/api/bsm/review-workspace/file?sessionHash=session-hash&reviewItemId=11111111-1111-4111-8111-111111111111&versionId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    await click(buttonByText(/Generated page proof/));
    await vi.waitFor(() => expect(container.querySelector<HTMLIFrameElement>('iframe[title="Generated page proof proof"]')?.getAttribute("src")).toBe("https://preview.example/generated-proof"));
    expect(container.querySelector<HTMLIFrameElement>('iframe[title="Generated page proof proof"]')?.getAttribute("src")).toBe("https://preview.example/generated-proof");
    expect(container.textContent).not.toContain("This proof does not have a working preview link yet.");

    await click(buttonByText(/PDF proof/));
    await vi.waitFor(() => expect(container.querySelector<HTMLIFrameElement>('iframe[title="PDF proof PDF proof"]')?.getAttribute("src")).toBe(
      "/api/bsm/review-workspace/file?sessionHash=session-hash&reviewItemId=33333333-3333-4333-8333-333333333333&versionId=cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ));
    expect(container.querySelector<HTMLIFrameElement>('iframe[title="PDF proof PDF proof"]')?.getAttribute("src")).toBe(
      "/api/bsm/review-workspace/file?sessionHash=session-hash&reviewItemId=33333333-3333-4333-8333-333333333333&versionId=cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    await click(buttonByText(/Image proof/));
    await vi.waitFor(() => expect(container.querySelector<HTMLImageElement>('img[alt="Image proof proof"]')?.getAttribute("src")).toBe("https://storage.example/proof.jpg"));
    expect(container.querySelector<HTMLImageElement>('img[alt="Image proof proof"]')?.getAttribute("src")).toBe("https://storage.example/proof.jpg");

    await change(byLabel("Private comment"), "Image proof needs the logo moved up.");
    await click(buttonByText("Add comment to selected document"));

    await vi.waitFor(() => {
      expect(vi.mocked(fetch).mock.calls).toEqual(
        expect.arrayContaining([
          [
            "/api/bsm/review-workspace/comments",
            expect.objectContaining({
              body: expect.stringContaining(`"reviewItemId":"${imageDocId}"`),
            }),
          ],
        ]),
      );
    });
    expect(container.textContent).toContain("Image proof needs the logo moved up.");
  });
});
