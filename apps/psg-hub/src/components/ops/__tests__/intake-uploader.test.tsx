import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  IntakeUploader,
  INTAKE_BUCKET,
  validateSlug,
  validateFileName,
  parseMintResponse,
} from "@/components/ops/intake-uploader";

describe("validateSlug (pure — mirrors server buildIntakePath)", () => {
  it("accepts lowercase kebab slugs", () => {
    expect(validateSlug("Company slug", "collision-leaders")).toBeNull();
    expect(validateSlug("Shop slug", "shelton-collision")).toBeNull();
    expect(validateSlug("x", "abc123")).toBeNull();
  });

  it("rejects empty, uppercase, spaces, and traversal", () => {
    expect(validateSlug("Company slug", "")).toBe("Company slug is required");
    expect(validateSlug("Company slug", "Collision")).toMatch(/kebab-case/);
    expect(validateSlug("Company slug", "a b")).toMatch(/kebab-case/);
    expect(validateSlug("Company slug", "../etc")).toMatch(/kebab-case/);
    expect(validateSlug("Company slug", "-lead")).toMatch(/kebab-case/);
    expect(validateSlug("Company slug", "x".repeat(101))).toMatch(/kebab-case/);
  });
});

describe("validateFileName (pure)", () => {
  it("accepts a single safe segment", () => {
    expect(validateFileName("export.csv")).toBeNull();
    expect(validateFileName("RO_2026-06-29.xml")).toBeNull();
  });

  it("rejects empty, traversal, slashes, and spaces", () => {
    expect(validateFileName("")).toBe("A file is required");
    expect(validateFileName("../secret")).toMatch(/single safe segment/);
    expect(validateFileName("a/b.csv")).toMatch(/single safe segment/);
    expect(validateFileName("my export.csv")).toMatch(/single safe segment/);
    expect(validateFileName("x".repeat(101))).toBe("File name is too long");
  });
});

describe("parseMintResponse (pure — route → typed result)", () => {
  it("200 with the full triple → ok", () => {
    const r = parseMintResponse(200, {
      path: "collision-leaders/shelton-collision/export.csv",
      signedUrl: "https://example.supabase.co/object/upload/sign/...",
      token: "tok_abc",
    });
    expect(r).toEqual({
      ok: true,
      path: "collision-leaders/shelton-collision/export.csv",
      signedUrl: "https://example.supabase.co/object/upload/sign/...",
      token: "tok_abc",
    });
  });

  it("200 missing token → error (incomplete is not success)", () => {
    const r = parseMintResponse(200, { path: "a/b/c.csv", signedUrl: "u" });
    expect(r.ok).toBe(false);
  });

  it("400/500 surface the route's own error message", () => {
    expect(parseMintResponse(400, { error: "companySlug must be a lowercase kebab-case slug" })).toEqual({
      ok: false,
      message: "companySlug must be a lowercase kebab-case slug",
    });
    expect(parseMintResponse(500, { error: "mintIntakeSignedUpload failed: boom" })).toEqual({
      ok: false,
      message: "mintIntakeSignedUpload failed: boom",
    });
  });

  it("falls back to a status message when no body/error", () => {
    const r = parseMintResponse(403, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("403");
  });
});

describe("IntakeUploader render (idle)", () => {
  const html = renderToStaticMarkup(<IntakeUploader />);

  it("targets the pilot-intake bucket", () => {
    expect(INTAKE_BUCKET).toBe("pilot-intake");
  });

  it("prefills the pilot slugs as editable inputs", () => {
    expect(html).toContain('value="collision-leaders"');
    expect(html).toContain('value="shelton-collision"');
  });

  it("renders the drop zone + submit, and NEVER a token", () => {
    expect(html).toMatch(/Drag &amp; drop/);
    expect(html).toContain("Upload to pilot-intake");
    expect(html.toLowerCase()).not.toContain("token");
  });
});
