import { describe, it, expect, vi } from "vitest";
import {
  BriefingUnavailableError,
  DEFAULT_RECIPIENT,
  briefingDocUrl,
  fetchBriefing,
  parseRecipients,
  subjectFor,
  dateLabelFor,
} from "../briefing";

describe("parseRecipients", () => {
  it("defaults to Nick when unset or empty", () => {
    expect(parseRecipients(undefined)).toEqual([DEFAULT_RECIPIENT]);
    expect(parseRecipients("")).toEqual([DEFAULT_RECIPIENT]);
    expect(parseRecipients("   ,  , ")).toEqual([DEFAULT_RECIPIENT]);
  });

  it("splits, trims, and drops empties", () => {
    expect(parseRecipients("a@x.com, b@y.com ,, c@z.com")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });

  it("de-duplicates case-insensitively, preserving first-seen order", () => {
    expect(parseRecipients("Nick@x.com, nick@x.com, b@y.com")).toEqual([
      "Nick@x.com",
      "b@y.com",
    ]);
  });
});

describe("subjectFor / dateLabelFor", () => {
  it("formats a dated subject in UTC", () => {
    expect(subjectFor("2026-07-08T12:03:36.999Z")).toBe(
      "PSG Board Briefing — Wed, Jul 8, 2026"
    );
  });

  it("formats a long date label in UTC", () => {
    expect(dateLabelFor("2026-07-08T12:03:36.999Z")).toBe(
      "Wednesday, July 8, 2026"
    );
  });

  it("falls back to the raw string on an unparseable date", () => {
    expect(subjectFor("not-a-date")).toBe("PSG Board Briefing — not-a-date");
  });
});

describe("briefingDocUrl", () => {
  it("joins base + issue path, trimming trailing slashes", () => {
    expect(briefingDocUrl("https://home.psgweb.me/", "abc")).toBe(
      "https://home.psgweb.me/issues/abc"
    );
  });
});

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchBriefing", () => {
  const base = { apiUrl: "https://home.psgweb.me", token: "read-tok" };

  it("returns the body/updatedAt/issueId on success and sends the bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        body: "# Briefing\nhello",
        updatedAt: "2026-07-08T12:03:36.999Z",
        issueId: "issue-1",
      })
    );
    const result = await fetchBriefing({ ...base, fetchImpl });
    expect(result.body).toContain("hello");
    expect(result.updatedAt).toBe("2026-07-08T12:03:36.999Z");
    expect(result.issueId).toBe("issue-1");

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://home.psgweb.me/api/issues/8684fab8-0aeb-4f02-8897-7d097ddf6288/documents/daily-briefing"
    );
    expect(opts?.headers).toMatchObject({
      Authorization: "Bearer read-tok",
    });
  });

  it("throws BriefingUnavailableError on a non-200 response — never returns a body", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { ok: false, status: 404 })
    );
    await expect(fetchBriefing({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      BriefingUnavailableError
    );
  });

  it("throws on an empty/whitespace body — the fail-honest path", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ body: "   \n  " }));
    await expect(
      fetchBriefing({ ...base, fetchImpl })
    ).rejects.toThrow(/empty/i);
  });

  it("throws when the network call itself fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(fetchBriefing({ ...base, fetchImpl })).rejects.toBeInstanceOf(
      BriefingUnavailableError
    );
  });
});
