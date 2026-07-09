import { describe, expect, it, vi } from "vitest";
import {
  claimBoardBriefingOutbox,
  markBoardBriefingOutboxSent,
} from "../outbox";

function createMarkSentService(result: { data: unknown; error: { message: string } | null }) {
  const maybeSingle = vi.fn(() => Promise.resolve(result));
  const select = vi.fn(() => ({ maybeSingle }));
  const is = vi.fn(() => ({ select }));
  const eqClaim = vi.fn(() => ({ is }));
  const eqId = vi.fn(() => ({ eq: eqClaim }));
  const update = vi.fn(() => ({ eq: eqId }));
  const from = vi.fn(() => ({ update }));

  return {
    service: { from },
    from,
    update,
    eqId,
    eqClaim,
    is,
    select,
    maybeSingle,
  };
}

describe("board briefing outbox helpers", () => {
  it("returns null when the claim RPC finds no unsent row", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const service = { rpc } as unknown as Parameters<typeof claimBoardBriefingOutbox>[0];

    await expect(
      claimBoardBriefingOutbox(service, {
        claimToken: "11111111-1111-4111-8111-111111111111",
        now: new Date("2026-07-09T12:10:00Z"),
      }),
    ).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("claim_board_briefing_outbox", {
      p_claim_token: "11111111-1111-4111-8111-111111111111",
      p_now: "2026-07-09T12:10:00.000Z",
    });
  });

  it("normalizes a claimed row from the RPC result", async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: "outbox-1",
            briefing_date: "2026-07-09",
            subject: "Daily board briefing",
            body_markdown: "Revenue is up.",
            briefing_url: "https://paperclip.example/doc",
            generated_at: "2026-07-09T12:00:00Z",
          },
        ],
        error: null,
      }),
    );
    const service = { rpc } as unknown as Parameters<typeof claimBoardBriefingOutbox>[0];

    await expect(
      claimBoardBriefingOutbox(service, {
        claimToken: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual({
      id: "outbox-1",
      briefingDate: "2026-07-09",
      subject: "Daily board briefing",
      bodyMarkdown: "Revenue is up.",
      briefingUrl: "https://paperclip.example/doc",
      generatedAt: "2026-07-09T12:00:00Z",
    });
  });

  it("marks only the matching claimed unsent row as sent", async () => {
    const chain = createMarkSentService({ data: { id: "outbox-1" }, error: null });
    const service = chain.service as unknown as Parameters<typeof markBoardBriefingOutboxSent>[0];

    await markBoardBriefingOutboxSent(
      service,
      "outbox-1",
      "11111111-1111-4111-8111-111111111111",
      {
        messageId: "msg-1",
        now: new Date("2026-07-09T12:11:00Z"),
      },
    );

    expect(chain.from).toHaveBeenCalledWith("board_briefing_outbox");
    expect(chain.update).toHaveBeenCalledWith({
      sent_at: "2026-07-09T12:11:00.000Z",
      send_message_id: "msg-1",
    });
    expect(chain.eqId).toHaveBeenCalledWith("id", "outbox-1");
    expect(chain.eqClaim).toHaveBeenCalledWith(
      "claim_token",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(chain.is).toHaveBeenCalledWith("sent_at", null);
  });

  it("throws if the claimed row was not updated", async () => {
    const chain = createMarkSentService({ data: null, error: null });
    const service = chain.service as unknown as Parameters<typeof markBoardBriefingOutboxSent>[0];

    await expect(
      markBoardBriefingOutboxSent(
        service,
        "outbox-1",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toThrow("claimed row was not updated");
  });
});
