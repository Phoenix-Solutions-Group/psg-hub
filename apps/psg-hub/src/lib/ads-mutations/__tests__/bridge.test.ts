import { afterEach, describe, expect, it } from "vitest";
import {
  DisabledBridge,
  RunnerError,
  SandboxGatedError,
  VercelSandboxBridge,
  extractRunnerJson,
  getBridge,
  isSandboxEnabled,
  RESULT_BEGIN,
  RESULT_END,
  type JobSpec,
  type LogMirror,
  type SandboxRunResult,
  type SandboxTransport,
} from "@/lib/ads-mutations/bridge";
import type { MutationRequest } from "@/lib/ads-mutations/types";

// A mocked sandbox transport — records the JobSpec it received and returns a canned run
// result. No @vercel/sandbox, no network: this is the seam the live transport implements.
function makeTransport(result: SandboxRunResult): {
  transport: SandboxTransport;
  specs: JobSpec[];
} {
  const specs: JobSpec[] = [];
  return {
    specs,
    transport: {
      async run(spec) {
        specs.push(spec);
        return result;
      },
    },
  };
}

function frame(payload: unknown): string {
  // Wrap like runner.py: incidental stdout noise around the sentinel block.
  return `pip noise...\n${RESULT_BEGIN}\n${JSON.stringify(payload)}\n${RESULT_END}\ntrailing\n`;
}

function recordingMirror(path: string | undefined): {
  mirror: LogMirror;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    mirror: {
      async store(input) {
        calls.push(input);
        return path;
      },
    },
  };
}

const baseReq: MutationRequest = {
  mutationKey: "google_ads.campaign_bidding",
  mode: "dry_run",
  targetRef: "1234567890",
  params: { changes: [{ campaign_id: 42, strategy: "MANUAL_CPC" }] },
};

const okStdout = frame({
  ok: true,
  before: [{ campaign_id: 42, strategy: "MANUAL_CPC" }],
  requestedChanges: [{ campaign_id: 42, strategy: "TARGET_CPA", target_cpa_micros: 5000000 }],
  after: null,
  log: { op: "google_ads.campaign_bidding", mode: "dry_run" },
});

describe("isSandboxEnabled / getBridge gating", () => {
  const prev = process.env.ADS_MUTATIONS_SANDBOX_ENABLED;
  afterEach(() => {
    process.env.ADS_MUTATIONS_SANDBOX_ENABLED = prev;
  });

  it("fails closed by default", () => {
    delete process.env.ADS_MUTATIONS_SANDBOX_ENABLED;
    expect(isSandboxEnabled()).toBe(false);
    expect(getBridge()).toBeInstanceOf(DisabledBridge);
  });

  it("returns the live bridge only when the flag is exactly 'true'", () => {
    process.env.ADS_MUTATIONS_SANDBOX_ENABLED = "true";
    expect(isSandboxEnabled()).toBe(true);
    expect(getBridge()).toBeInstanceOf(VercelSandboxBridge);

    process.env.ADS_MUTATIONS_SANDBOX_ENABLED = "1";
    expect(isSandboxEnabled()).toBe(false);
    expect(getBridge()).toBeInstanceOf(DisabledBridge);
  });
});

describe("DisabledBridge fails closed", () => {
  it("throws SandboxGatedError on both paths", async () => {
    const b = new DisabledBridge();
    await expect(b.dryRun()).rejects.toBeInstanceOf(SandboxGatedError);
    await expect(b.execute()).rejects.toBeInstanceOf(SandboxGatedError);
  });
});

describe("extractRunnerJson", () => {
  it("extracts the sentinel-framed payload", () => {
    expect(JSON.parse(extractRunnerJson(okStdout)).ok).toBe(true);
  });
  it("uses the last sentinel block when several are present", () => {
    const s = frame({ ok: false }) + frame({ ok: true, n: 2 });
    expect(JSON.parse(extractRunnerJson(s)).n).toBe(2);
  });
  it("falls back to the last non-empty line without sentinels", () => {
    expect(JSON.parse(extractRunnerJson('noise\n{"ok":true}\n')).ok).toBe(true);
  });
});

describe("VercelSandboxBridge.dryRun", () => {
  it("serializes the JobSpec, parses the diff, and mirrors the log", async () => {
    const { transport, specs } = makeTransport({
      stdout: okStdout,
      stderr: "",
      exitCode: 0,
      sandboxId: "sbx-1",
    });
    const { mirror, calls } = recordingMirror("1234567890/sbx-1-dry_run-x.json");
    const bridge = new VercelSandboxBridge({ transport, mirror });

    const res = await bridge.dryRun(baseReq);

    // Job spec carried mode=dry_run + the request fields verbatim.
    expect(specs).toHaveLength(1);
    expect(specs[0]).toEqual({
      mutationKey: "google_ads.campaign_bidding",
      mode: "dry_run",
      targetRef: "1234567890",
      params: baseReq.params,
    });

    // Diff parsed back out.
    expect(res.before).toEqual([{ campaign_id: 42, strategy: "MANUAL_CPC" }]);
    expect((res.requestedChanges as unknown[])[0]).toMatchObject({ campaign_id: 42 });
    expect(res.after).toBeNull();
    expect((res as unknown as { sandboxId: string }).sandboxId).toBe("sbx-1");

    // Log mirrored, path threaded into the result.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ targetRef: "1234567890", sandboxId: "sbx-1", mode: "dry_run" });
    expect(res.logsStoragePath).toBe("1234567890/sbx-1-dry_run-x.json");
  });

  it("defaults params to {} when the request omits them", async () => {
    const { transport, specs } = makeTransport({
      stdout: okStdout,
      stderr: "",
      exitCode: 0,
      sandboxId: "sbx-2",
    });
    const bridge = new VercelSandboxBridge({ transport, mirror: recordingMirror("p").mirror });
    await bridge.dryRun({ ...baseReq, params: undefined as unknown as Record<string, unknown> });
    expect(specs[0].params).toEqual({});
  });

  it("throws for an unknown mutation key (before provisioning anything)", async () => {
    const { transport, specs } = makeTransport({
      stdout: okStdout,
      stderr: "",
      exitCode: 0,
      sandboxId: "sbx-x",
    });
    const bridge = new VercelSandboxBridge({ transport, mirror: recordingMirror("p").mirror });
    await expect(bridge.dryRun({ ...baseReq, mutationKey: "nope.bad" })).rejects.toThrow(
      /Unknown mutation key/
    );
    expect(specs).toHaveLength(0); // never reached the transport
  });
});

describe("VercelSandboxBridge.execute", () => {
  it("uses mode=execute and returns the after-state", async () => {
    const stdout = frame({
      ok: true,
      before: [{ campaign_id: 42 }],
      requestedChanges: [{ campaign_id: 42 }],
      after: [{ campaign_id: 42, resource_name: "rn/42" }],
      log: { op: "google_ads.campaign_bidding", mode: "execute" },
    });
    const { transport, specs } = makeTransport({ stdout, stderr: "", exitCode: 0, sandboxId: "sbx-3" });
    const { mirror } = recordingMirror("logs/x.json");
    const bridge = new VercelSandboxBridge({ transport, mirror });

    const res = await bridge.execute({ ...baseReq, mode: "execute" });
    expect(specs[0].mode).toBe("execute");
    expect(res.after).toEqual([{ campaign_id: 42, resource_name: "rn/42" }]);
    expect(res.logsStoragePath).toBe("logs/x.json");
  });
});

describe("VercelSandboxBridge error paths", () => {
  it("throws RunnerError when the runner reports ok:false", async () => {
    const stdout = frame({ ok: false, errorType: "RuntimeError", error: "missing creds" });
    const { transport } = makeTransport({ stdout, stderr: "", exitCode: 1, sandboxId: "sbx-e" });
    const bridge = new VercelSandboxBridge({ transport, mirror: recordingMirror("p").mirror });
    await expect(bridge.dryRun(baseReq)).rejects.toMatchObject({
      name: "RunnerError",
    });
    await expect(bridge.dryRun(baseReq)).rejects.toThrow(/missing creds/);
  });

  it("throws RunnerError on a non-zero exit even if stdout parsed ok", async () => {
    const { transport } = makeTransport({
      stdout: okStdout,
      stderr: "boom",
      exitCode: 137,
      sandboxId: "sbx-k",
    });
    const bridge = new VercelSandboxBridge({ transport, mirror: recordingMirror("p").mirror });
    await expect(bridge.dryRun(baseReq)).rejects.toBeInstanceOf(RunnerError);
  });

  it("throws RunnerError on unparseable stdout", async () => {
    const { transport } = makeTransport({
      stdout: "Traceback (most recent call last): kaboom",
      stderr: "fatal",
      exitCode: 1,
      sandboxId: "sbx-u",
    });
    const bridge = new VercelSandboxBridge({ transport, mirror: recordingMirror("p").mirror });
    await expect(bridge.dryRun(baseReq)).rejects.toThrow(/unparseable output/);
  });

  it("never mirrors a log when the runner failed", async () => {
    const stdout = frame({ ok: false, error: "x" });
    const { transport } = makeTransport({ stdout, stderr: "", exitCode: 1, sandboxId: "sbx-n" });
    const { mirror, calls } = recordingMirror("p");
    const bridge = new VercelSandboxBridge({ transport, mirror });
    await expect(bridge.dryRun(baseReq)).rejects.toBeInstanceOf(RunnerError);
    expect(calls).toHaveLength(0);
  });

  it("tolerates a log-mirror failure (undefined path) without failing the mutation", async () => {
    const { transport } = makeTransport({
      stdout: okStdout,
      stderr: "",
      exitCode: 0,
      sandboxId: "sbx-m",
    });
    const bridge = new VercelSandboxBridge({ transport, mirror: recordingMirror(undefined).mirror });
    const res = await bridge.dryRun(baseReq);
    expect(res.logsStoragePath).toBeUndefined();
    expect(res.before).toBeTruthy();
  });

  it("skips the mirror entirely when the runner emits no log", async () => {
    const stdout = frame({ ok: true, before: null, requestedChanges: null, after: null });
    const { transport } = makeTransport({ stdout, stderr: "", exitCode: 0, sandboxId: "sbx-z" });
    const { mirror, calls } = recordingMirror("p");
    const bridge = new VercelSandboxBridge({ transport, mirror });
    const res = await bridge.dryRun(baseReq);
    expect(calls).toHaveLength(0);
    expect(res.logsStoragePath).toBeUndefined();
  });
});
