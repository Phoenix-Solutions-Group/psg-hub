import { describe, it, expect, vi } from "vitest";
import {
  nextBatchStatusOnPrint,
  toMailAddress,
  buildMailDocument,
  resolveDocumentSort,
  printDocument,
  printBatch,
  reprintDocument,
  createBatchSchema,
  buildBatchDocuments,
  generateBatchSchema,
  type DocumentRow,
  type ProductionClient,
} from "@/lib/ops/production";
import type { MailAdapter } from "@/lib/production/types";

const ADDRESS = {
  name: "Jane Customer",
  line1: "210 King St",
  line2: null,
  city: "San Francisco",
  state: "CA",
  postal_code: "94107",
};

const DOC: DocumentRow = {
  id: "doc-1",
  batch_id: "batch-1",
  piece_type: "postcard",
  to_address: ADDRESS,
  from_address: { ...ADDRESS, name: "PSG Shop" },
  rendered_url: "https://assets.test/doc-1.pdf",
  product_id: "prod-1",
};

/** Stub MailAdapter that records submits. */
function stubAdapter(): MailAdapter & { submit: ReturnType<typeof vi.fn> } {
  const submit = vi.fn(async () => ({
    vendor: "lob" as const,
    externalId: "psc_new",
    status: "created" as const,
    expectedDeliveryDate: "2026-07-05",
    proofUrl: "https://assets.test/psc_new.pdf",
  }));
  return {
    vendor: "lob",
    submit,
    verifyAddress: vi.fn(),
    cancel: vi.fn(),
  } as unknown as MailAdapter & { submit: ReturnType<typeof vi.fn> };
}

/** Hand-rolled fake of the slice of supabase the orchestration uses. */
function makeClient(doc: DocumentRow | null) {
  const single = vi.fn(async () => ({ data: doc, error: null }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const insert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single }) }),
    update,
    insert,
  }));
  const client = { from } as unknown as ProductionClient;
  return { client, from, single, update, updateEq, insert };
}

describe("nextBatchStatusOnPrint", () => {
  it("advances active batches to printing and blocks terminal ones", () => {
    expect(nextBatchStatusOnPrint("draft")).toBe("printing");
    expect(nextBatchStatusOnPrint("queued")).toBe("printing");
    expect(nextBatchStatusOnPrint("printing")).toBe("printing");
    expect(nextBatchStatusOnPrint("historical")).toBeNull();
    expect(nextBatchStatusOnPrint("cancelled")).toBeNull();
  });
});

describe("toMailAddress / buildMailDocument", () => {
  it("maps the stored jsonb address onto MailAddress", () => {
    expect(toMailAddress(ADDRESS)).toEqual({
      name: "Jane Customer",
      addressLine1: "210 King St",
      addressLine2: undefined,
      city: "San Francisco",
      state: "CA",
      zip: "94107",
      country: "US",
    });
  });

  it("puts the rendered asset in front for postcards and file for letters", () => {
    const postcard = buildMailDocument(DOC);
    expect(postcard.front).toBe("https://assets.test/doc-1.pdf");
    expect(postcard.metadata).toEqual({ batchId: "batch-1" });

    const letter = buildMailDocument({ ...DOC, piece_type: "letter" });
    expect(letter.file).toBe("https://assets.test/doc-1.pdf");
    expect(letter.front).toBeUndefined();
  });
});

describe("resolveDocumentSort", () => {
  it("allow-lists columns and defaults to created_at desc", () => {
    expect(resolveDocumentSort("status", "asc")).toEqual({ column: "status", ascending: true });
    expect(resolveDocumentSort("evil; drop", "desc")).toEqual({
      column: "created_at",
      ascending: false,
    });
  });
});

describe("printDocument", () => {
  it("submits via the adapter and persists external_id + status back on the row", async () => {
    const { client, update, insert } = makeClient(DOC);
    const adapter = stubAdapter();
    const outcome = await printDocument(client, adapter, "doc-1");

    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(outcome).toEqual({
      documentId: "doc-1",
      externalId: "psc_new",
      status: "created",
      vendor: "lob",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: "psc_new", vendor: "lob", status: "created" })
    );
    // A first print is not a reprint — no audit row.
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws when the document is missing", async () => {
    const { client } = makeClient(null);
    await expect(printDocument(client, stubAdapter(), "missing")).rejects.toThrow(/not found/);
  });

  it("resolves the adapter from the document's vendor when passed a resolver", async () => {
    // Document carries an in-house vendor choice (mirrors the per-template/per-shop
    // selection persisted at queue time); the resolver must build the inhouse adapter.
    const { client } = makeClient({ ...DOC, vendor: "inhouse" });
    const lob = stubAdapter();
    const inhouse = stubAdapter();
    const requested: string[] = [];
    const resolver = (vendor: "lob" | "inhouse") => {
      requested.push(vendor);
      return vendor === "inhouse" ? inhouse : lob;
    };

    await printDocument(client, resolver, "doc-1");

    expect(requested).toEqual(["inhouse"]);
    expect(inhouse.submit).toHaveBeenCalledOnce();
    expect(lob.submit).not.toHaveBeenCalled();
  });

  it("defaults the resolver to lob when the document has no vendor", async () => {
    const { client } = makeClient(DOC); // DOC has no vendor field
    const requested: string[] = [];
    const resolver = (vendor: "lob" | "inhouse") => {
      requested.push(vendor);
      return stubAdapter();
    };
    await printDocument(client, resolver, "doc-1");
    expect(requested).toEqual(["lob"]);
  });
});

describe("reprintDocument", () => {
  it("re-submits AND writes the production_reprint_log audit row", async () => {
    const { client, insert } = makeClient(DOC);
    const adapter = stubAdapter();
    const outcome = await reprintDocument(client, adapter, "doc-1", "actor-9", "smudged print");

    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(outcome.externalId).toBe("psc_new");
    // The audit gate: every reprint writes a log row (who/why).
    expect(insert).toHaveBeenCalledWith({
      document_id: "doc-1",
      reprinted_by_profile_id: "actor-9",
      reason: "smudged print",
    });
  });

  it("does not write the audit row if the re-submit fails", async () => {
    const { client, insert } = makeClient(DOC);
    const adapter = stubAdapter();
    adapter.submit.mockRejectedValueOnce(new Error("vendor down"));
    await expect(reprintDocument(client, adapter, "doc-1", "actor-9")).rejects.toThrow(/vendor down/);
    expect(insert).not.toHaveBeenCalled();
  });
});

/** Fake that records per-table update() values so the batch finalize is observable. */
function makeBatchClient(doc: DocumentRow) {
  const updates: Record<string, Record<string, unknown>[]> = {};
  const inserts: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: doc, error: null }) }) }),
    update: (values: Record<string, unknown>) => {
      (updates[table] ??= []).push(values);
      return { eq: async () => ({ error: null }) };
    },
    insert: async (row: Record<string, unknown>) => {
      inserts.push(row);
      return { error: null };
    },
  }));
  return { client: { from } as unknown as ProductionClient, updates, inserts };
}

describe("printBatch", () => {
  it("prints each document then moves the batch printing→historical with printed_at", async () => {
    const { client, updates } = makeBatchClient(DOC);
    const adapter = stubAdapter();
    const printedAt = "2026-06-18T18:00:00.000Z";

    const outcome = await printBatch(client, adapter, "batch-1", ["doc-1", "doc-2"], printedAt);

    expect(adapter.submit).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("historical");
    expect(outcome.printed).toHaveLength(2);
    expect(updates.production_batches).toEqual([
      { status: "historical", printed_at: printedAt },
    ]);
  });

  it("does not finalize the batch when a document submit fails", async () => {
    const { client, updates } = makeBatchClient(DOC);
    const adapter = stubAdapter();
    adapter.submit.mockRejectedValueOnce(new Error("vendor down"));

    await expect(
      printBatch(client, adapter, "batch-1", ["doc-1"], "2026-06-18T18:00:00.000Z")
    ).rejects.toThrow(/vendor down/);
    // The batch must stay where it was — never marked historical on a partial failure.
    expect(updates.production_batches).toBeUndefined();
  });

  it("finalizes a batch with no documents to submit (all already printed)", async () => {
    const { client, updates } = makeBatchClient(DOC);
    const adapter = stubAdapter();

    const outcome = await printBatch(client, adapter, "batch-1", [], "2026-06-18T18:00:00.000Z");

    expect(adapter.submit).not.toHaveBeenCalled();
    expect(outcome.status).toBe("historical");
    expect(updates.production_batches).toHaveLength(1);
  });
});

describe("createBatchSchema", () => {
  it("requires a name and a uuid company", () => {
    expect(createBatchSchema.safeParse({ name: "July TY", company_id: crypto.randomUUID() }).success).toBe(true);
    expect(createBatchSchema.safeParse({ name: "", company_id: "x" }).success).toBe(false);
  });
});

describe("generateBatchSchema", () => {
  it("defaults the product to the warranty letter and accepts a customer subset", () => {
    const parsed = generateBatchSchema.safeParse({
      name: "July Warranty",
      company_id: crypto.randomUUID(),
      repair_customer_ids: [crypto.randomUUID()],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.product).toBe("warranty");
  });

  it("rejects an unknown product and a non-uuid company", () => {
    expect(
      generateBatchSchema.safeParse({ name: "X", company_id: crypto.randomUUID(), product: "flyer" }).success
    ).toBe(false);
    expect(generateBatchSchema.safeParse({ name: "X", company_id: "nope" }).success).toBe(false);
  });
});

describe("buildBatchDocuments", () => {
  const company = {
    id: "co-1",
    name: "Apex Collision",
    phone: "555-0100",
    address: { line1: "1 Shop Way", city: "Austin", state: "TX", postal_code: "73301" },
  };
  const customers = [
    {
      id: "cust-1",
      first_name: "Alex",
      last_name: "Driver",
      address: { line1: "9 Elm St", city: "Austin", state: "TX", postal_code: "78701" },
      vehicle: "Honda Civic",
    },
    {
      id: "cust-2",
      first_name: "Robin",
      last_name: "Payne",
      address: { line1: "12 Oak Ave", city: "Dallas", state: "TX", postal_code: "75201" },
    },
  ];

  it("renders one letter document per customer with snapshotted to/from addresses", () => {
    const built = buildBatchDocuments(company, customers, { product: "warranty", productId: "prod-9" });

    expect(built.documentCount).toBe(2);
    expect(built.vendor).toBe("lob"); // default vendor (no override)
    expect(built.documents).toHaveLength(2);

    const [doc] = built.documents;
    expect(doc.piece_type).toBe("letter");
    expect(doc.product_id).toBe("prod-9");
    expect(doc.status).toBe("rendered");
    expect(doc.repair_customer_id).toBe("cust-1");
    // to = the customer, from = the shop — both snapshotted as the stored jsonb shape.
    expect(doc.to_address).toMatchObject({ name: "Alex Driver", line1: "9 Elm St", city: "Austin", state: "TX", postal_code: "78701" });
    expect(doc.from_address).toMatchObject({ name: "Apex Collision", line1: "1 Shop Way", postal_code: "73301" });
    // The rendered asset is the merged, Lob-submittable letter HTML.
    expect(doc.rendered_url).toContain("Dear Alex");
    expect(doc.rendered_url).toContain("Apex Collision");
  });

  it("honours an explicit in-house vendor override and reports unresolved tokens", () => {
    const built = buildBatchDocuments(company, [customers[1]], { product: "warranty", vendor: "inhouse" });

    expect(built.vendor).toBe("inhouse");
    expect(built.documents[0].vendor).toBe("inhouse");
    // cust-2 has no vehicle/serviceDate — the warranty template flags them missing.
    const missing = built.missingByCustomer.find((m) => m.repairCustomerId === "cust-2");
    expect(missing?.tokens).toEqual(expect.arrayContaining(["customer.vehicle"]));
  });

  it("returns an empty plan when there are no customers", () => {
    const built = buildBatchDocuments(company, [], { product: "warranty" });
    expect(built.documentCount).toBe(0);
    expect(built.documents).toEqual([]);
  });

  // PSG-333: the really-mailed piece must resolve the inside-address block from
  // the customer's stored address (not just the envelope) and the batch date,
  // so a live batch reads as cleanly as the proof path (which fills everything
  // from SAMPLE_MERGE_DATA). Before this, those tokens rendered literally.
  it("maps the customer's stored address + batch letterDate into the letter body", () => {
    const built = buildBatchDocuments(company, [customers[0]], {
      product: "thank_you",
      letterDate: "June 2026",
    });
    const doc = built.documents[0];
    // The inside-address block resolves from the same jsonb used for to_address.
    expect(doc.rendered_url).toContain("9 Elm St");
    expect(doc.rendered_url).toContain("June 2026");
    // ...and the engine no longer reports them as unresolved.
    const missing = built.missingByCustomer.find((m) => m.repairCustomerId === "cust-1")?.tokens ?? [];
    expect(missing).not.toContain("customer.addressLine1");
    expect(missing).not.toContain("customer.city");
    expect(missing).not.toContain("customer.state");
    expect(missing).not.toContain("customer.zip");
    expect(missing).not.toContain("customer.letterDate");
  });

  it("leaves letterDate unresolved (and surfaced) when the route omits it", () => {
    const built = buildBatchDocuments(company, [customers[0]], { product: "thank_you" });
    const missing = built.missingByCustomer.find((m) => m.repairCustomerId === "cust-1")?.tokens ?? [];
    // Stays pure: no clock inside the builder — an omitted date is reported, not invented.
    expect(missing).toContain("customer.letterDate");
  });

  it("surfaces address tokens as missing when the customer's address is blank", () => {
    const built = buildBatchDocuments(
      company,
      [{ id: "cust-3", first_name: "Sam", last_name: "Vale", address: {} }],
      { product: "thank_you", letterDate: "June 2026" }
    );
    const missing = built.missingByCustomer.find((m) => m.repairCustomerId === "cust-3")?.tokens ?? [];
    // Empty-string address parts must not masquerade as filled (fail-closed reporting).
    expect(missing).toContain("customer.addressLine1");
  });
});
