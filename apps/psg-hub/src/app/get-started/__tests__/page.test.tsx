import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/leads/inbound-lead-form", () => ({
  InboundLeadForm: () => <div>Lead form</div>,
}));

describe("Get a demo preview gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns not found when the server preview flag is absent", async () => {
    vi.stubEnv("GET_STARTED_PREVIEW", "");
    const { default: GetStartedPage } = await import("../page");

    expect(() => GetStartedPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders only when the server preview flag is explicitly enabled", async () => {
    vi.stubEnv("GET_STARTED_PREVIEW", "1");
    const { default: GetStartedPage } = await import("../page");

    const html = renderToStaticMarkup(GetStartedPage());

    expect(html).toContain("Request a demo");
    expect(html).toContain("Lead form");
    expect(notFound).not.toHaveBeenCalled();
  });
});
