import { describe, it, expect } from "vitest";
import { InHouseAdapter, INHOUSE_ID_PREFIX } from "@/lib/production/inhouse";
import { MailProductionError, type MailDocument } from "@/lib/production/types";

const ADDR = {
  name: "Jane Customer",
  addressLine1: "210 King St",
  city: "San Francisco",
  state: "CA",
  zip: "94107",
};

const POSTCARD: MailDocument = {
  documentId: "doc-1",
  pieceType: "postcard",
  to: ADDR,
  from: { ...ADDR, name: "PSG Shop" },
  front: "https://assets.test/doc-1.pdf",
};

describe("InHouseAdapter", () => {
  it("identifies as the inhouse vendor", () => {
    expect(new InHouseAdapter().vendor).toBe("inhouse");
  });

  it("queues a postcard with a deterministic, idempotent job id derived from documentId", async () => {
    const adapter = new InHouseAdapter();
    const a = await adapter.submit(POSTCARD);
    const b = await adapter.submit(POSTCARD);

    expect(a.vendor).toBe("inhouse");
    expect(a.externalId).toBe(`${INHOUSE_ID_PREFIX}doc-1`);
    expect(a.status).toBe("created");
    expect(a.expectedDeliveryDate).toBeNull();
    // The print-ready asset doubles as the proof.
    expect(a.proofUrl).toBe("https://assets.test/doc-1.pdf");
    // Idempotent: a retried submit yields the same id (queue dedupes, no double-print).
    expect(b.externalId).toBe(a.externalId);
  });

  it("uses the letter file as the print asset", async () => {
    const adapter = new InHouseAdapter();
    const result = await adapter.submit({
      documentId: "ltr-9",
      pieceType: "letter",
      to: ADDR,
      from: ADDR,
      file: "https://assets.test/ltr-9.pdf",
    });
    expect(result.externalId).toBe(`${INHOUSE_ID_PREFIX}ltr-9`);
    expect(result.proofUrl).toBe("https://assets.test/ltr-9.pdf");
  });

  it("rejects a piece with no rendered asset as a non-retryable caller bug", async () => {
    const adapter = new InHouseAdapter();
    await expect(
      adapter.submit({ documentId: "doc-2", pieceType: "postcard", to: ADDR, from: ADDR })
    ).rejects.toMatchObject({
      name: "MailProductionError",
      vendor: "inhouse",
      retryable: false,
    });
    await expect(
      adapter.submit({ documentId: "doc-2", pieceType: "postcard", to: ADDR, from: ADDR })
    ).rejects.toBeInstanceOf(MailProductionError);
  });

  it("verifyAddress reports unknown / not-deliverable (no in-house USPS verification)", async () => {
    const result = await new InHouseAdapter().verifyAddress(ADDR);
    expect(result.deliverability).toBe("unknown");
    expect(result.deliverable).toBe(false);
  });

  it("cancel resolves (no remote system to call)", async () => {
    await expect(new InHouseAdapter().cancel("inhouse_doc-1")).resolves.toBeUndefined();
  });

  it("supports an injected job-id generator", async () => {
    const adapter = new InHouseAdapter({ generateJobId: (id) => `custom-${id}` });
    const result = await adapter.submit(POSTCARD);
    expect(result.externalId).toBe("custom-doc-1");
  });
});
