import { describe, it, expect, vi } from "vitest";
import type { MailMessage } from "@/lib/mail/types";
import {
  buildDigestDeliverer,
  buildOverdueDigestReport,
  createOverdueDigestClient,
  formatDigestHtml,
  formatDigestSubject,
  formatDigestText,
  isTaskOverdue,
  parseRecipients,
  runOverdueDigest,
  toIsoDate,
  type DigestProject,
  type DigestTask,
  type OverdueDigestClient,
} from "../overdue-digest";

// A fixed "today" so all overdue math is deterministic (no wall clock in assertions).
const ASOF = new Date("2026-07-07T09:00:00Z");

function task(over: Partial<DigestTask> & { id: number }): DigestTask {
  return {
    id: over.id,
    title: over.title ?? `Task ${over.id}`,
    projectId: "projectId" in over ? (over.projectId ?? null) : 1,
    parentTaskId: over.parentTaskId ?? null,
    dueDate: over.dueDate ?? null,
    done: over.done ?? false,
  };
}

const PROJECTS: DigestProject[] = [
  { id: 1, title: "Ace Auto Body", boardId: 3 },
  { id: 2, title: "Bright Collision", boardId: 3 },
];

describe("isTaskOverdue — the pilot-QA-critical predicate", () => {
  it("flags a not-done task due strictly before asOf", () => {
    expect(isTaskOverdue(task({ id: 1, dueDate: "2026-07-06", done: false }), ASOF)).toBe(true);
  });
  it("does NOT flag a task due today (not yet overdue)", () => {
    expect(isTaskOverdue(task({ id: 1, dueDate: "2026-07-07", done: false }), ASOF)).toBe(false);
  });
  it("does NOT flag a future task", () => {
    expect(isTaskOverdue(task({ id: 1, dueDate: "2026-07-08", done: false }), ASOF)).toBe(false);
  });
  it("does NOT flag a done task even if past due", () => {
    expect(isTaskOverdue(task({ id: 1, dueDate: "2026-01-01", done: true }), ASOF)).toBe(false);
  });
  it("does NOT flag a task with no due date", () => {
    expect(isTaskOverdue(task({ id: 1, dueDate: null, done: false }), ASOF)).toBe(false);
  });
  it("handles full ISO timestamps in due_date by comparing the date only", () => {
    expect(
      isTaskOverdue(task({ id: 1, dueDate: "2026-07-06T23:59:00Z" as string, done: false }), ASOF),
    ).toBe(true);
  });
});

describe("buildOverdueDigestReport", () => {
  it("groups overdue steps by client, worst-behind first, and counts totals", () => {
    const tasks: DigestTask[] = [
      task({ id: 10, projectId: 1, title: "Publish blog post", dueDate: "2026-07-01" }), // 6d
      task({ id: 11, projectId: 1, title: "Update GBP", dueDate: "2026-07-05" }), // 2d
      task({ id: 12, projectId: 1, title: "Done step", dueDate: "2026-01-01", done: true }), // skip
      task({ id: 13, projectId: 1, title: "Future step", dueDate: "2026-08-01" }), // skip
      task({ id: 20, projectId: 2, title: "Send report", dueDate: "2026-07-06" }), // 1d
    ];
    const report = buildOverdueDigestReport(tasks, PROJECTS, ASOF);

    expect(report.asOf).toBe("2026-07-07");
    expect(report.allCaughtUp).toBe(false);
    expect(report.totalOverdue).toBe(3);
    expect(report.clientsBehind).toBe(2);

    // Ace (worst 6d) ranks before Bright (worst 1d).
    expect(report.clients.map((c) => c.client)).toEqual(["Ace Auto Body", "Bright Collision"]);

    const ace = report.clients[0];
    expect(ace.worstDaysOverdue).toBe(6);
    // Steps sorted most-overdue first.
    expect(ace.steps.map((s) => s.step)).toEqual(["Publish blog post", "Update GBP"]);
    expect(ace.steps[0].daysOverdue).toBe(6);
    expect(ace.steps[1].daysOverdue).toBe(2);
  });

  it("returns allCaughtUp with zero clients when nothing is overdue", () => {
    const report = buildOverdueDigestReport(
      [task({ id: 1, dueDate: "2026-07-07" }), task({ id: 2, done: true, dueDate: "2026-01-01" })],
      PROJECTS,
      ASOF,
    );
    expect(report.allCaughtUp).toBe(true);
    expect(report.totalOverdue).toBe(0);
    expect(report.clientsBehind).toBe(0);
    expect(report.clients).toEqual([]);
  });

  it("labels tasks whose project is not in the catalog as Project #<id> (no silent drop)", () => {
    const report = buildOverdueDigestReport(
      [task({ id: 1, projectId: 99, dueDate: "2026-07-01" })],
      PROJECTS,
      ASOF,
    );
    expect(report.clients[0].client).toBe("Project #99");
  });

  it("skips tasks with no project id (not client delivery work)", () => {
    const report = buildOverdueDigestReport(
      [task({ id: 1, projectId: null, dueDate: "2026-07-01" })],
      PROJECTS,
      ASOF,
    );
    expect(report.allCaughtUp).toBe(true);
  });
});

describe("formatters", () => {
  const report = buildOverdueDigestReport(
    [
      task({ id: 10, projectId: 1, title: "Publish blog post", dueDate: "2026-07-01" }),
      task({ id: 20, projectId: 2, title: "Send report", dueDate: "2026-07-06" }),
    ],
    PROJECTS,
    ASOF,
  );

  it("subject summarizes behind counts", () => {
    expect(formatDigestSubject(report)).toBe(
      "Weekly overdue digest (2026-07-07) — 2 clients behind, 2 step(s)",
    );
  });

  it("text digest lists each client and step with days overdue", () => {
    const text = formatDigestText(report);
    expect(text).toContain("Ace Auto Body");
    expect(text).toContain("Publish blog post (due 2026-07-01, 6 days overdue)");
    expect(text).toContain("Send report (due 2026-07-06, 1 day overdue)");
  });

  it("all-caught-up renders a single clean line, no empty sections", () => {
    const clean = buildOverdueDigestReport([], PROJECTS, ASOF);
    expect(formatDigestSubject(clean)).toContain("all caught up");
    expect(formatDigestText(clean)).toContain("All caught up");
    // No per-client "N step(s) behind" section leaks into the clean digest.
    expect(formatDigestText(clean)).not.toContain("step(s)");
  });

  it("html escapes client/step names", () => {
    const evil = buildOverdueDigestReport(
      [task({ id: 1, projectId: 1, title: "<script>x</script>", dueDate: "2026-07-01" })],
      [{ id: 1, title: "A & B <Body>", boardId: 3 }],
      ASOF,
    );
    const html = formatDigestHtml(evil);
    expect(html).toContain("A &amp; B &lt;Body&gt;");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("parseRecipients", () => {
  it("splits on commas/semicolons/whitespace and keeps only addresses", () => {
    expect(parseRecipients("a@x.com, b@y.com;c@z.com  d@w.com")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
      "d@w.com",
    ]);
  });
  it("returns [] for blank/undefined", () => {
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("not-an-email")).toEqual([]);
  });
});

describe("buildDigestDeliverer", () => {
  const report = buildOverdueDigestReport(
    [task({ id: 10, projectId: 1, title: "Publish blog post", dueDate: "2026-07-01" })],
    PROJECTS,
    ASOF,
  );

  it("always logs, and emails when a sender + recipients are wired", async () => {
    const lines: string[] = [];
    const sendEmail = vi.fn((msg: MailMessage) => Promise.resolve({ statusCode: 202, to: msg.to }));
    const deliver = buildDigestDeliverer({
      sendEmail,
      recipients: ["staff@psg.test"],
      log: (l) => lines.push(l),
      from: "noreply@psg.test",
    });

    const channels = await deliver(report);

    expect(channels).toEqual(["log", "email"]);
    expect(lines.some((l) => l.startsWith("[overdue-digest] ALERT"))).toBe(true);
    expect(lines.some((l) => l.includes("BEHIND Ace Auto Body"))).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toEqual(["staff@psg.test"]);
    expect(msg.subject).toContain("1 client behind");
    expect(msg.text).toContain("Publish blog post");
  });

  it("degrades to log-only when no recipients", async () => {
    const lines: string[] = [];
    const sendEmail = vi.fn(async () => ({ statusCode: 202 }));
    const channels = await buildDigestDeliverer({
      sendEmail,
      recipients: [],
      log: (l) => lines.push(l),
    })(report);
    expect(channels).toEqual(["log"]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not throw when email fails — falls back to log-only", async () => {
    const lines: string[] = [];
    const sendEmail = vi.fn(async () => {
      throw new Error("SendGrid down");
    });
    const channels = await buildDigestDeliverer({
      sendEmail,
      recipients: ["staff@psg.test"],
      log: (l) => lines.push(l),
    })(report);
    expect(channels).toEqual(["log"]);
    expect(lines.some((l) => l.includes("email delivery failed"))).toBe(true);
  });

  it("logs a clean 'ok' line on the all-caught-up path", async () => {
    const lines: string[] = [];
    await buildDigestDeliverer({ recipients: [], log: (l) => lines.push(l) })(
      buildOverdueDigestReport([], PROJECTS, ASOF),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[overdue-digest] ok");
    expect(lines[0]).toContain("all caught up");
  });
});

// ── thin adapter: cursor pagination + read-only + no-URL-in-errors ──────────────────

function jsonResponse(data: unknown, additional: unknown = {}) {
  return new Response(JSON.stringify({ success: true, data, additional_data: additional }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createOverdueDigestClient", () => {
  it("paginates GET /api/v2/tasks via next_cursor and maps rows", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const u = new URL(typeof input === "string" ? input : input.toString());
      calls.push(u.pathname + (u.searchParams.get("cursor") ? `?cursor=${u.searchParams.get("cursor")}` : ""));
      const cursor = u.searchParams.get("cursor");
      if (u.pathname.endsWith("/tasks")) {
        if (!cursor) {
          return jsonResponse(
            [{ id: 1, title: "A", project_id: 5, due_date: "2026-07-01", done: false }],
            { next_cursor: "PAGE2" },
          );
        }
        return jsonResponse([
          { id: 2, title: "B", project_id: 5, parent_task_id: 1, due_date: null, done: 1 },
        ]);
      }
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const client = createOverdueDigestClient({ apiKey: "tok", fetchImpl });
    const tasks = await client.listAllTasks();

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ id: 1, projectId: 5, dueDate: "2026-07-01", done: false });
    // `done: 1` coerces to boolean true; null due date preserved.
    expect(tasks[1]).toMatchObject({ id: 2, parentTaskId: 1, dueDate: null, done: true });
    // Second page requested with the cursor.
    expect(calls.some((c) => c.includes("cursor=PAGE2"))).toBe(true);
  });

  it("issues only GET requests (read-only) with the token in the query string", async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      methods.push((init?.method ?? "GET").toUpperCase());
      const u = new URL(typeof input === "string" ? input : input.toString());
      expect(u.searchParams.get("api_token")).toBe("tok");
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    const client = createOverdueDigestClient({ apiKey: "tok", fetchImpl });
    await client.listAllTasks();
    await client.listAllProjects();
    expect(methods.every((m) => m === "GET")).toBe(true);
  });

  it("throws a token-free error on HTTP failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const client = createOverdueDigestClient({ apiKey: "supersecret", fetchImpl });
    await expect(client.listAllTasks()).rejects.toThrow(/HTTP 500/);
    await expect(client.listAllTasks()).rejects.not.toThrow(/supersecret/);
  });
});

describe("runOverdueDigest orchestrator", () => {
  const fakeClient = (tasks: DigestTask[], projects: DigestProject[]): OverdueDigestClient => ({
    listAllTasks: async () => tasks,
    listAllProjects: async () => projects,
  });

  it("reads, composes, delivers, and returns a success summary", async () => {
    const deliver = vi.fn(async () => ["log", "email"]);
    const result = await runOverdueDigest({
      client: fakeClient(
        [task({ id: 10, projectId: 1, title: "Publish blog post", dueDate: "2026-07-01" })],
        PROJECTS,
      ),
      asOf: ASOF,
      deliver,
    });
    expect(result.ok).toBe(true);
    expect(result.totalOverdue).toBe(1);
    expect(result.clientsBehind).toBe(1);
    expect(result.delivered).toEqual(["log", "email"]);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("captures a Pipedrive read failure as ok:false (route maps to 502)", async () => {
    const result = await runOverdueDigest({
      client: {
        listAllTasks: async () => {
          throw new Error("Pipedrive GET /api/v2/tasks returned HTTP 502");
        },
        listAllProjects: async () => [],
      },
      asOf: ASOF,
      deliver: async () => ["log"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("HTTP 502");
    expect(result.asOf).toBe("2026-07-07");
    expect(result.delivered).toEqual([]);
  });
});

describe("toIsoDate", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(toIsoDate(new Date("2026-07-07T23:30:00Z"))).toBe("2026-07-07");
  });
});
