import { describe, it, expect, vi } from "vitest";
import { recordMailVendorEvent, type ProductionJobClient } from "@/lib/production/jobs";
import type { MailWebhookEvent } from "@/lib/production/types";

const EVENT: MailWebhookEvent = {
  vendor: "lob",
  externalId: "psc_abc123",
  status: "delivered",
  eventType: "postcard.delivered",
  occurredAt: "2026-07-01T12:00:00Z",
  raw: { event_type: { id: "postcard.delivered" } },
};

/** A hand-rolled fake of the slice of the supabase client jobs.ts uses. */
function makeClient(opts: {
  doc?: { id: string } | null;
  lookupError?: { message: string } | null;
  upsertError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const upsert = vi.fn(async () => ({ error: opts.upsertError ?? null }));
  const updateEq = vi.fn(async () => ({ error: opts.updateError ?? null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const maybeSingle = vi.fn(async () => ({
    data: opts.doc ?? null,
    error: opts.lookupError ?? null,
  }));
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
    upsert,
    update,
  }));
  const client = { from } as unknown as ProductionJobClient;
  return { client, from, upsert, update, updateEq, maybeSingle };
}

describe("recordMailVendorEvent", () => {
  it("upserts the vendor job and advances the document status", async () => {
    const { client, upsert, update, updateEq } = makeClient({ doc: { id: "doc-1" } });
    const result = await recordMailVendorEvent(EVENT, client);

    expect(result).toEqual({ documentId: "doc-1", documentUpdated: true });

    // Idempotent upsert keyed on (external_id, status).
    const [rows, options] = upsert.mock.calls[0] as unknown as [
      Record<string, unknown>[],
      { onConflict: string; ignoreDuplicates: boolean }
    ];
    expect(rows[0]).toMatchObject({
      document_id: "doc-1",
      vendor: "lob",
      external_id: "psc_abc123",
      status: "delivered",
      event_type: "postcard.delivered",
    });
    expect(options).toEqual({ onConflict: "external_id,status", ignoreDuplicates: true });

    expect(update).toHaveBeenCalledWith({ status: "delivered" });
    expect(updateEq).toHaveBeenCalledWith("id", "doc-1");
  });

  it("records the vendor job but skips status update when no document matches", async () => {
    const { client, upsert, update } = makeClient({ doc: null });
    const result = await recordMailVendorEvent(EVENT, client);
    expect(result).toEqual({ documentId: null, documentUpdated: false });
    expect(upsert).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not overwrite document status on an 'unknown' event", async () => {
    const { client, update } = makeClient({ doc: { id: "doc-1" } });
    const result = await recordMailVendorEvent(
      { ...EVENT, status: "unknown", eventType: "postcard.something_new" },
      client
    );
    expect(result.documentUpdated).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("throws on a persistence error so the webhook returns 500", async () => {
    const { client } = makeClient({ doc: { id: "doc-1" }, upsertError: { message: "db down" } });
    await expect(recordMailVendorEvent(EVENT, client)).rejects.toThrow(/upsert failed: db down/);
  });
});
