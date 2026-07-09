import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BoardBriefingOutboxRow {
  id: string;
  briefingDate: string;
  subject?: string;
  bodyMarkdown: string;
  briefingUrl: string;
  generatedAt?: string;
}

interface ClaimOptions {
  claimToken: string;
  now?: Date;
}

interface MarkSentOptions {
  messageId?: string;
  now?: Date;
}

type ClaimedRow = {
  id?: unknown;
  briefing_date?: unknown;
  subject?: unknown;
  body_markdown?: unknown;
  briefing_url?: unknown;
  generated_at?: unknown;
};

function firstRow(value: unknown): ClaimedRow | null {
  if (Array.isArray(value)) return (value[0] as ClaimedRow | undefined) ?? null;
  return (value as ClaimedRow | null) ?? null;
}

function toOutboxRow(row: ClaimedRow): BoardBriefingOutboxRow {
  if (
    typeof row.id !== "string" ||
    typeof row.briefing_date !== "string" ||
    typeof row.body_markdown !== "string" ||
    typeof row.briefing_url !== "string"
  ) {
    throw new Error("claim_board_briefing_outbox returned an invalid row");
  }

  return {
    id: row.id,
    briefingDate: row.briefing_date,
    bodyMarkdown: row.body_markdown,
    briefingUrl: row.briefing_url,
    subject: typeof row.subject === "string" ? row.subject : undefined,
    generatedAt: typeof row.generated_at === "string" ? row.generated_at : undefined,
  };
}

export async function claimBoardBriefingOutbox(
  service: SupabaseClient,
  options: ClaimOptions,
): Promise<BoardBriefingOutboxRow | null> {
  const { data, error } = await service.rpc("claim_board_briefing_outbox", {
    p_claim_token: options.claimToken,
    p_now: (options.now ?? new Date()).toISOString(),
  });
  if (error) throw new Error(`claimBoardBriefingOutbox: ${error.message}`);

  const row = firstRow(data);
  return row ? toOutboxRow(row) : null;
}

export async function markBoardBriefingOutboxSent(
  service: SupabaseClient,
  id: string,
  claimToken: string,
  options: MarkSentOptions = {},
): Promise<void> {
  const { data, error } = await service
    .from("board_briefing_outbox")
    .update({
      sent_at: (options.now ?? new Date()).toISOString(),
      send_message_id: options.messageId ?? null,
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .is("sent_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`markBoardBriefingOutboxSent: ${error.message}`);
  if (!data) throw new Error("markBoardBriefingOutboxSent: claimed row was not updated");
}
