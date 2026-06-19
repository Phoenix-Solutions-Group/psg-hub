import { describe, expect, it } from "vitest";
import {
  buildCreateOptions,
  describeAuthMode,
  describeSandboxCreateError,
  resolveAppCwd,
  resolveSandboxTimeoutMs,
} from "@/lib/ads-mutations/sandbox-transport";

const REPO = "https://github.com/Phoenix-Solutions-Group/psg-hub.git";

describe("resolveAppCwd", () => {
  it("joins a relative appDir onto the default /vercel/sandbox clone root (PSG-119)", () => {
    // The PSG-118 400 was a bare relative cwd -> SDK chdir from `/` fails. cwd must be
    // absolute under the clone root where the git source is checked out.
    expect(resolveAppCwd("apps/psg-ads-mutations", undefined)).toBe(
      "/vercel/sandbox/apps/psg-ads-mutations"
    );
  });

  it("passes an already-absolute appDir through unchanged", () => {
    expect(resolveAppCwd("/srv/pkg", undefined)).toBe("/srv/pkg");
  });

  it("honors a clone-root override and normalizes slashes", () => {
    expect(resolveAppCwd("/apps/x", "/custom/root/")).toBe("/apps/x"); // absolute wins
    expect(resolveAppCwd("apps/x", "/custom/root/")).toBe("/custom/root/apps/x");
  });

  it("falls back to the default root when the override is blank", () => {
    expect(resolveAppCwd("apps/x", "   ")).toBe("/vercel/sandbox/apps/x");
  });
});

describe("resolveSandboxTimeoutMs", () => {
  it("defaults to 10 minutes when unset", () => {
    expect(resolveSandboxTimeoutMs(undefined)).toBe(600_000);
  });

  it("clamps above the 45-minute SDK maximum", () => {
    // A mis-set env (e.g. seconds-as-ms, or > 45min) must degrade to a valid request
    // instead of producing the swallowed 400 we saw in PSG-118.
    expect(resolveSandboxTimeoutMs("3600000")).toBe(2_700_000);
  });

  it("clamps non-positive / non-numeric to the floor or default", () => {
    expect(resolveSandboxTimeoutMs("0")).toBe(600_000);
    expect(resolveSandboxTimeoutMs("not-a-number")).toBe(600_000);
    expect(resolveSandboxTimeoutMs("500")).toBe(1_000); // below min floor
  });

  it("passes a valid in-range value through", () => {
    expect(resolveSandboxTimeoutMs("120000")).toBe(120_000);
  });
});

describe("buildCreateOptions", () => {
  it("pins the python3.13 runtime by default (node22 default has no pip/python)", () => {
    const opts = buildCreateOptions({}, REPO);
    expect(opts.runtime).toBe("python3.13");
    expect(opts.source).toEqual({ type: "git", url: REPO, revision: "main" });
    expect(opts.timeout).toBe(600_000);
  });

  it("honors runtime + revision overrides", () => {
    const opts = buildCreateOptions(
      {
        ADS_MUTATIONS_SANDBOX_RUNTIME: "node22",
        ADS_MUTATIONS_REPO_REVISION: "abc123",
      },
      REPO
    );
    expect(opts.runtime).toBe("node22");
    expect(opts.source.revision).toBe("abc123");
  });

  it("omits auth fields when no VERCEL_TOKEN is set (SDK falls back to OIDC)", () => {
    const opts = buildCreateOptions({}, REPO);
    expect(opts.token).toBeUndefined();
    expect(opts.teamId).toBeUndefined();
    expect(opts.projectId).toBeUndefined();
  });

  it("forwards the operator's scoped token + scope when set", () => {
    const opts = buildCreateOptions(
      {
        VERCEL_TOKEN: "vtok",
        VERCEL_TEAM_ID: "team_1",
        VERCEL_PROJECT_ID: "prj_1",
      },
      REPO
    );
    expect(opts.token).toBe("vtok");
    expect(opts.teamId).toBe("team_1");
    expect(opts.projectId).toBe("prj_1");
  });
});

describe("describeAuthMode", () => {
  it("reports explicit token + scope", () => {
    expect(
      describeAuthMode({
        VERCEL_TOKEN: "x",
        VERCEL_TEAM_ID: "t",
        VERCEL_PROJECT_ID: "p",
      })
    ).toContain("teamId+projectId");
  });

  it("flags a token with no scope", () => {
    expect(describeAuthMode({ VERCEL_TOKEN: "x" })).toContain(
      "no teamId/projectId"
    );
  });

  it("flags the likely-unauthenticated OIDC case", () => {
    expect(describeAuthMode({})).toContain("likely unauthenticated");
  });

  it("reports OIDC when the OIDC token is present", () => {
    expect(
      describeAuthMode({ VERCEL_OIDC_TOKEN: "oidc" })
    ).toContain("VERCEL_OIDC_TOKEN present");
  });
});

describe("describeSandboxCreateError", () => {
  it("surfaces the HTTP body hidden behind the SDK's generic message", async () => {
    // Mimic the @vercel/sandbox throw shape: generic message + a fetch Response on .response
    // whose body carries the real 400 reason.
    const err = Object.assign(new Error("Status code 400 is not ok"), {
      status: 400,
      response: {
        status: 400,
        statusText: "Bad Request",
        text: async () => '{"error":{"code":"forbidden","message":"sandbox not entitled"}}',
      },
    });
    const out = await describeSandboxCreateError(err);
    expect(out).toContain("Status code 400 is not ok");
    expect(out).toContain("status=400");
    expect(out).toContain("sandbox not entitled");
  });

  it("handles a plain Error with no response", async () => {
    const out = await describeSandboxCreateError(new Error("ECONNREFUSED"));
    expect(out).toContain("ECONNREFUSED");
  });

  it("reads a string body and a cause chain", async () => {
    const err = Object.assign(new Error("boom"), {
      response: "raw 400 text body",
      cause: new Error("underlying"),
    });
    const out = await describeSandboxCreateError(err);
    expect(out).toContain("raw 400 text body");
    expect(out).toContain("underlying");
  });

  it("does not throw on a non-error value", async () => {
    const out = await describeSandboxCreateError("just a string");
    expect(out).toContain("just a string");
  });
});
