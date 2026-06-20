import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  normalizeState,
  inferWebsiteCandidate,
  slugify,
  cleanText,
} from "../normalize";
import { heuristicProvider } from "../heuristic-provider";
import {
  discoverShopProfile,
  selectProvider,
} from "../index";
import type { DiscoveryProvider } from "../types";

describe("normalize", () => {
  it("normalizePhone formats 10-digit US numbers", () => {
    expect(normalizePhone("4024414800")).toBe("(402) 441-4800");
    expect(normalizePhone("(402) 441-4800")).toBe("(402) 441-4800");
    expect(normalizePhone("402.441.4800")).toBe("(402) 441-4800");
  });

  it("normalizePhone strips a leading US country code", () => {
    expect(normalizePhone("1-402-441-4800")).toBe("(402) 441-4800");
  });

  it("normalizePhone rejects implausible numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("normalizeState yields a 2-letter uppercase code or null", () => {
    expect(normalizeState("ne")).toBe("NE");
    expect(normalizeState(" Ne ")).toBe("NE");
    expect(normalizeState("Nebraska")).toBeNull();
    expect(normalizeState("")).toBeNull();
    expect(normalizeState(null)).toBeNull();
  });

  it("slugify produces url-safe slugs", () => {
    expect(slugify("Tracy's Collision Center")).toBe("tracy-s-collision-center");
    expect(slugify("  A&B Auto  ")).toBe("a-b-auto");
  });

  it("inferWebsiteCandidate guesses a www .com from the name", () => {
    expect(inferWebsiteCandidate("Tracys Body Shop")).toBe(
      "https://www.tracysbodyshop.com"
    );
    expect(inferWebsiteCandidate("   ")).toBeNull();
    expect(inferWebsiteCandidate("!!!")).toBeNull();
  });

  it("cleanText trims to non-empty or null", () => {
    expect(cleanText("  hi ")).toBe("hi");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

describe("heuristicProvider", () => {
  const input = {
    shopName: "Tracy's Collision Center",
    addressStreet: "1500 Center Park Rd",
    city: "Lincoln",
    state: "ne",
  };

  it("echoes user fields and infers a website candidate, none verified", async () => {
    const p = await heuristicProvider.discover(input);
    expect(p.provider).toBe("heuristic");
    expect(p.shopName.value).toBe("Tracy's Collision Center");
    expect(p.addressStreet.value).toBe("1500 Center Park Rd");
    expect(p.addressLocality.value).toBe("Lincoln");
    expect(p.addressRegion.value).toBe("NE"); // normalized
    expect(p.websiteUrl.value).toBe("https://www.tracyscollisioncenter.com");
    expect(p.websiteUrl.source).toBe("inferred");
    // Verified-facts mandate: NOTHING is verified by the offline provider.
    const fields = [
      p.shopName,
      p.websiteUrl,
      p.phone,
      p.hours,
      p.addressStreet,
      p.addressLocality,
      p.addressRegion,
      p.reviewSummary,
    ];
    expect(fields.every((f) => f.verified === false)).toBe(true);
  });

  it("marks externally-sourced fields as pending", async () => {
    const p = await heuristicProvider.discover(input);
    expect(p.pending).toEqual(["phone", "hours", "reviews", "competitors"]);
    expect(p.phone.value).toBeNull();
    expect(p.reviewSummary.value).toBeNull();
    expect(p.competitors).toEqual([]);
  });

  it("is deterministic / idempotent for the same input", async () => {
    const a = await heuristicProvider.discover(input);
    const b = await heuristicProvider.discover(input);
    expect(a).toEqual(b);
  });

  it("handles a bare name with no address", async () => {
    const p = await heuristicProvider.discover({ shopName: "Acme" });
    expect(p.addressStreet.value).toBeNull();
    expect(p.addressStreet.confidence).toBe(0);
    expect(p.websiteUrl.value).toBe("https://www.acme.com");
  });
});

describe("discoverShopProfile", () => {
  it("trims the shop name before dispatching", async () => {
    const p = await discoverShopProfile({ shopName: "  Acme  " });
    expect(p.shopName.value).toBe("Acme");
  });

  it("throws on an empty shop name", async () => {
    await expect(discoverShopProfile({ shopName: "   " })).rejects.toThrow(
      /shopName required/
    );
  });

  it("uses an injected provider when supplied", async () => {
    const spy: DiscoveryProvider = {
      name: "spy",
      discover: async (i) => ({
        ...(await heuristicProvider.discover(i)),
        provider: "spy",
      }),
    };
    const p = await discoverShopProfile({ shopName: "Acme" }, spy);
    expect(p.provider).toBe("spy");
  });
});

describe("selectProvider", () => {
  it("defaults to the heuristic provider", () => {
    expect(selectProvider(undefined).name).toBe("heuristic");
  });

  it("falls back to heuristic for an unknown / unconfigured provider", () => {
    expect(selectProvider("google_places").name).toBe("heuristic");
  });
});
