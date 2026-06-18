import { describe, it, expect } from "vitest";
import {
  resolveSort,
  appendDocument,
  canTransition,
  createRepairCustomerSchema,
  createRepairOrderSchema,
  addDocumentSchema,
  type RepairOrderDocument,
} from "../repair";

describe("resolveSort", () => {
  it("defaults to last_name ascending", () => {
    expect(resolveSort(null, null)).toEqual({ column: "last_name", ascending: true });
  });
  it("honors an allow-listed column + desc", () => {
    expect(resolveSort("created_at", "desc")).toEqual({ column: "created_at", ascending: false });
  });
  it("falls back when the column is not allow-listed (no SQL injection surface)", () => {
    expect(resolveSort("first_name; drop table", "asc")).toEqual({
      column: "last_name",
      ascending: true,
    });
  });
});

describe("appendDocument", () => {
  it("creates the documents array on an empty payload", () => {
    const out = appendDocument(null, { name: "Estimate", kind: "estimate" }, "id-1", "2026-06-18T00:00:00Z");
    expect(out.documents).toHaveLength(1);
    expect((out.documents as RepairOrderDocument[])[0]).toMatchObject({
      id: "id-1",
      name: "Estimate",
      kind: "estimate",
      url: null,
      note: null,
    });
  });
  it("appends without mutating the original payload", () => {
    const payload = { documents: [{ id: "a", name: "x", kind: "other", url: null, note: null, added_at: "t" }] };
    const out = appendDocument(payload, { name: "Supplement", kind: "supplement", url: "https://e.com/s.pdf" }, "id-2", "t2");
    expect(payload.documents).toHaveLength(1); // unchanged
    expect(out.documents).toHaveLength(2);
    expect((out.documents as RepairOrderDocument[])[1].url).toBe("https://e.com/s.pdf");
  });
  it("preserves other payload keys", () => {
    const out = appendDocument({ note: "keep" }, { name: "D", kind: "other" }, "id", "t");
    expect(out.note).toBe("keep");
  });
});

describe("canTransition", () => {
  it("allows open -> preview/cancelled/closed", () => {
    expect(canTransition("open", "preview")).toBe(true);
    expect(canTransition("open", "cancelled")).toBe(true);
    expect(canTransition("open", "closed")).toBe(true);
  });
  it("allows preview -> open (back to edit)", () => {
    expect(canTransition("preview", "open")).toBe(true);
  });
  it("treats cancelled and closed as terminal", () => {
    expect(canTransition("cancelled", "open")).toBe(false);
    expect(canTransition("closed", "open")).toBe(false);
  });
  it("is a no-op for same status", () => {
    expect(canTransition("cancelled", "cancelled")).toBe(true);
  });
});

describe("schemas", () => {
  it("requires names on a repair customer", () => {
    expect(createRepairCustomerSchema.safeParse({ company_id: crypto.randomUUID(), first_name: "", last_name: "Doe" }).success).toBe(false);
    expect(
      createRepairCustomerSchema.safeParse({
        company_id: crypto.randomUUID(),
        first_name: "Jane",
        last_name: "Doe",
      }).success,
    ).toBe(true);
  });
  it("requires ro_number + ids on a repair order", () => {
    const ok = createRepairOrderSchema.safeParse({
      repair_customer_id: crypto.randomUUID(),
      company_id: crypto.randomUUID(),
      ro_number: "RO-1001",
    });
    expect(ok.success).toBe(true);
    expect(createRepairOrderSchema.safeParse({ ro_number: "x" }).success).toBe(false);
  });
  it("validates document payloads", () => {
    expect(addDocumentSchema.safeParse({ name: "Photo set" }).success).toBe(true);
    expect(addDocumentSchema.safeParse({ name: "" }).success).toBe(false);
    expect(addDocumentSchema.safeParse({ name: "Bad", url: "not-a-url" }).success).toBe(false);
  });
});
