import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestProject, DigestTask } from "@/lib/pipedrive/overdue-digest";

// Fake read-only client: returns synthetic tasks/projects; records the GET calls so we
// can prove the QA readout is read-only (no create/update/delete surface exists here).
const listAllTasks = vi.fn<() => Promise<DigestTask[]>>();
const listAllProjects = vi.fn<() => Promise<DigestProject[]>>();

// Partial mock: keep the REAL pure report/verify logic, swap only the network client.
vi.mock("@/lib/pipedrive/overdue-digest", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/pipedrive/overdue-digest")>();
  return { ...actual, createOverdueDigestClient: () => ({ listAllTasks, listAllProjects }) };
});
const sendEmail = vi.fn();
vi.mock("@/lib/mail/sendgrid", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

import { GET, POST } from "../route";

function t(over: Partial<DigestTask>): DigestTask {
  return { id: 0, title: "step", projectId: 100, parentTaskId: null, dueDate: null, done: false, ...over };
}
const TASKS: DigestTask[] = [
  t({ id: 1, title: "GBP post", projectId: 100, dueDate: "2026-07-05" }), // behind 2d
  t({ id: 2, title: "Blog draft", projectId: 100, dueDate: "2026-07-01" }), // behind 6d
  t({ id: 3, title: "Report", projectId: 200, dueDate: "2026-07-06" }), // behind 1d, other client
  t({ id: 4, title: "Due today", projectId: 100, dueDate: "2026-07-07" }),
  t({ id: 5, title: "Future", projectId: 100, dueDate: "2026-07-10" }),
  t({ id: 6, title: "Done late", projectId: 100, dueDate: "2026-07-01", done: true }),
  t({ id: 7, title: "No due", projectId: 100, dueDate: null }),
  t({ id: 8, title: "Orphan", projectId: null, dueDate: "2026-07-01" }),
];
const PROJECTS: DigestProject[] = [
  { id: 100, title: "Acme Collision", boardId: 3 },
  { id: 200, title: "Bright Auto Body", boardId: 3 },
];

function req(opts: { auth?: string; qa?: string; asOf?: string } = {}): Request {
  const url = `http://localhost/api/cron/overdue-digest${opts.asOf ? `?asOf=${opts.asOf}` : ""}`;
  const headers: Record<string, string> = {};
  if (opts.auth) headers.authorization = opts.auth;
  if (opts.qa) headers["x-overdue-qa-secret"] = opts.qa;
  return new Request(url, { headers });
}

beforeEach(() => {
  listAllTasks.mockReset().mockResolvedValue(TASKS);
  listAllProjects.mockReset().mockResolvedValue(PROJECTS);
  sendEmail.mockReset();
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("PIPEDRIVE_API_TOKEN", "tok");
  vi.stubEnv("PIPEDRIVE_COMPANY_DOMAIN", "acme");
  vi.stubEnv("OVERDUE_DIGEST_QA_SECRET", "qa-secret");
  vi.stubEnv("OVERDUE_DIGEST_RECIPIENTS", ""); // log-only, no email
});
afterEach(() => vi.unstubAllEnvs());

describe("overdue-digest auth gate", () => {
  it("401 with no credentials — Pipedrive never read", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(listAllTasks).not.toHaveBeenCalled();
  });

  it("401 with a wrong QA secret", async () => {
    const res = await POST(req({ qa: "nope" }));
    expect(res.status).toBe(401);
    expect(listAllTasks).not.toHaveBeenCalled();
  });

  it("401 when OVERDUE_DIGEST_QA_SECRET is unset (mode locked)", async () => {
    vi.stubEnv("OVERDUE_DIGEST_QA_SECRET", "");
    const res = await POST(req({ qa: "qa-secret" }));
    expect(res.status).toBe(401);
    expect(listAllTasks).not.toHaveBeenCalled();
  });
});

describe("QA readout mode (PSG-666)", () => {
  it("200 with full report + classification; read-only, no email", async () => {
    const res = await POST(req({ qa: "qa-secret", asOf: "2026-07-07" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.mode).toBe("qa-readout");
    expect(body.asOf).toBe("2026-07-07");
    expect(body.totalOverdue).toBe(3);
    expect(body.clientsBehind).toBe(2);
    expect(body.allCaughtUp).toBe(false);
    expect(body.taxonomyConsistent).toBe(true);
    expect(body.tasksScanned).toBe(8);

    // Boundary categories all accounted for.
    expect(body.categoryCounts).toMatchObject({
      behind: 3, "due-today": 1, future: 1, "done-past-due": 1, "no-due-date": 1, "no-project": 1,
    });

    // Operator lines carry the per-client detail.
    expect(body.operatorLines).toContain(
      "[overdue-digest] BEHIND Acme Collision: 2 step(s), worst 6d — Blog draft (6d); GBP post (2d)",
    );

    // Boundary snapshot spans the excluded categories too (so QA sees what was NOT flagged).
    const cats = new Set(body.boundarySnapshot.map((r: { category: string }) => r.category));
    expect(cats.has("behind")).toBe(true);
    expect(cats.has("due-today")).toBe(true);
    expect(cats.has("future")).toBe(true);
    expect(cats.has("done-past-due")).toBe(true);

    // Read-only + no delivery on the QA path.
    expect(listAllTasks).toHaveBeenCalledTimes(1);
    expect(listAllProjects).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("502 (no token leak) when the Pipedrive read fails", async () => {
    listAllTasks.mockRejectedValue(new Error("Pipedrive GET /api/v2/tasks returned HTTP 500"));
    const res = await POST(req({ qa: "qa-secret" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(String(body.error)).not.toContain("api_token");
  });

  it("503 when Pipedrive is not configured", async () => {
    vi.stubEnv("PIPEDRIVE_API_TOKEN", "");
    vi.stubEnv("PIPEDRIVE_API_KEY", "");
    const res = await POST(req({ qa: "qa-secret" }));
    expect(res.status).toBe(503);
  });
});

describe("normal cron path still works", () => {
  it("200 summary with the CRON secret (delivers log-only, no email)", async () => {
    const res = await GET(req({ auth: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.totalOverdue).toBe(3);
    expect(body.delivered).toContain("log");
    expect(sendEmail).not.toHaveBeenCalled(); // no recipients wired
  });
});
