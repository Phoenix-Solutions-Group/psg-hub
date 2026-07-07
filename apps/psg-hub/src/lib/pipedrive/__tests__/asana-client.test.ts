import { describe, it, expect, vi } from "vitest";
import {
  createAsanaClient,
  resolveAsanaToken,
  AsanaClientError,
  ASANA_TOKEN_ENV_CANDIDATES,
} from "../asana-client";

/** A fetch fake that returns queued JSON payloads and records the requests it saw. */
function scriptedFetch(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("resolveAsanaToken", () => {
  it("reads the canonical var then aliases, trimming", () => {
    expect(resolveAsanaToken({ ASANA_ACCESS_TOKEN: " abc " })).toBe("abc");
    expect(resolveAsanaToken({ ASANA_PAT: "p" })).toBe("p");
    expect(resolveAsanaToken({ ASANA_TOKEN: "t" })).toBe("t");
    expect(resolveAsanaToken({})).toBe("");
  });
  it("exposes the candidate names", () => {
    expect(ASANA_TOKEN_ENV_CANDIDATES).toContain("ASANA_ACCESS_TOKEN");
  });
});

describe("createAsanaClient", () => {
  it("throws (token-free message) when no token is configured", () => {
    expect(() => createAsanaClient({ token: "" })).toThrow(AsanaClientError);
  });

  it("sends the token as a Bearer header, never in the URL", async () => {
    const f = scriptedFetch([{ body: { data: [] } }]);
    const client = createAsanaClient({ token: "SECRET", fetchImpl: f.impl });
    await client.listProjectTaskTree("PROJ");
    const call = f.calls[0];
    expect(call.url).not.toContain("SECRET");
    expect((call.init?.headers as Record<string, string>).Authorization).toBe("Bearer SECRET");
  });

  it("scrubs the URL/token from errors on a non-ok response", async () => {
    const f = scriptedFetch([{ ok: false, status: 403, body: {} }]);
    const client = createAsanaClient({ token: "SECRET", fetchImpl: f.impl });
    await expect(client.listProjectTaskTree("PROJ")).rejects.toMatchObject({
      status: 403,
    });
    await expect(client.listProjectTaskTree("PROJ")).rejects.not.toThrow(/SECRET/);
  });

  it("flattens top-level tasks + subtasks into one parent-linked list", async () => {
    const f = scriptedFetch([
      // page 1: project tasks — task A has a subtask
      { body: { data: [{ gid: "A", name: "A", completed: false, num_subtasks: 1 }, { gid: "B", name: "B", completed: true }] } },
      // subtasks of A
      { body: { data: [{ gid: "A1", name: "A1", completed: false }] } },
      // subtasks of A1 (none)
      { body: { data: [] } },
    ]);
    const client = createAsanaClient({ token: "x", fetchImpl: f.impl });
    const tree = await client.listProjectTaskTree("PROJ");
    const byGid = Object.fromEntries(tree.map((t) => [t.gid, t]));
    expect(Object.keys(byGid).sort()).toEqual(["A", "A1", "B"]);
    expect(byGid["A1"].parentGid).toBe("A");
    expect(byGid["B"].completed).toBe(true);
  });

  it("maps assignee, due_at→date, section, and permalink", async () => {
    const f = scriptedFetch([
      {
        body: {
          data: [
            {
              gid: "A",
              name: "A",
              completed: false,
              assignee: { gid: "u9", name: "Jane" },
              due_at: "2026-08-01T10:00:00Z",
              permalink_url: "https://app.asana.com/0/1/A",
              memberships: [{ section: { name: "In Progress" } }],
            },
          ],
        },
      },
    ]);
    const client = createAsanaClient({ token: "x", fetchImpl: f.impl });
    const [a] = await client.listProjectTaskTree("PROJ");
    expect(a.assigneeGid).toBe("u9");
    expect(a.assigneeName).toBe("Jane");
    expect(a.dueOn).toBe("2026-08-01T10:00:00Z"); // normalization happens in the planner
    expect(a.sectionName).toBe("In Progress");
    expect(a.permalinkUrl).toBe("https://app.asana.com/0/1/A");
  });

  it("follows next_page pagination to completion", async () => {
    const f = scriptedFetch([
      { body: { data: [{ gid: "A", name: "A", completed: false }], next_page: { offset: "PAGE2" } } },
      { body: { data: [{ gid: "C", name: "C", completed: false }], next_page: null } },
    ]);
    const client = createAsanaClient({ token: "x", fetchImpl: f.impl });
    const tree = await client.listProjectTaskTree("PROJ");
    expect(tree.map((t) => t.gid).sort()).toEqual(["A", "C"]);
    expect(f.calls[1].url).toContain("offset=PAGE2");
  });

  it("keeps only user comment stories with text", async () => {
    const f = scriptedFetch([
      {
        body: {
          data: [
            { gid: "s1", type: "comment", text: "real comment", created_by: { name: "Bob" }, created_at: "2026-07-01" },
            { gid: "s2", type: "system", text: "changed the due date" },
            { gid: "s3", type: "comment", text: "   " },
            { gid: "s4", resource_subtype: "comment_added", text: "subtype comment" },
          ],
        },
      },
    ]);
    const client = createAsanaClient({ token: "x", fetchImpl: f.impl });
    const comments = await client.listTaskComments("A");
    expect(comments.map((c) => c.text)).toEqual(["real comment", "subtype comment"]);
    expect(comments[0].authorName).toBe("Bob");
  });
});
