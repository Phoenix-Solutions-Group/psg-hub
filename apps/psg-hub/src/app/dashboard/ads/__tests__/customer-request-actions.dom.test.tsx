// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerRequestActions } from "../customer-request-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("Expected a clickable element");
  flushSync(() => element.click());
}

describe("CustomerRequestActions dialog", () => {
  it("opens on the heading, closes with Escape, and restores the trigger focus", async () => {
    flushSync(() => root.render(<CustomerRequestActions shopId="shop-1" canSubmit campaigns={[{ id: "campaign-1", name: "Search" }]} />));
    const trigger = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Request a change")!;

    click(trigger);
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement?.textContent).toBe("Tell PSG what you need");

    flushSync(() => dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    await Promise.resolve();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses on the backdrop but not on a click inside the dialog", () => {
    flushSync(() => root.render(<CustomerRequestActions shopId="shop-1" canSubmit campaigns={[]} />));
    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Request a change")!);
    const dialog = container.querySelector("dialog")!;

    flushSync(() => dialog.firstElementChild?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dialog.open).toBe(true);
    flushSync(() => dialog.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dialog.open).toBe(false);
  });
});
