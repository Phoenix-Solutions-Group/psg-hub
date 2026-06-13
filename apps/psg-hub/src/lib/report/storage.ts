// Phase 12 / 12-03 — Report artifact persistence (private Supabase Storage).
// Stores the rendered PDF and the eval-passed narrative JSON in the PRIVATE bucket
// "monthly-reports", keyed by "{shopId}/{period}.{ext}". Writes go through the
// service client (RLS-bypass; the bucket's member-SELECT RLS gates customer reads
// via the download route). Upserts are idempotent so a re-run overwrites in place.
//
// The storage client is dependency-injected (deps.storage); the default binding is
// the service client's storage. Tests pass a mock and never touch the network.

import { createServiceClient } from "../supabase/service";
import type { ReportNarrative } from "./schema";

/** The private bucket holding every shop's monthly PDF + narrative JSON. */
export const REPORTS_BUCKET = "monthly-reports";

/** The minimal storage surface this module needs (one bucket handle factory). */
export type ReportStorage = {
  from(bucket: string): {
    upload(
      path: string,
      body: ArrayBuffer | ArrayBufferView | Blob | Uint8Array | string,
      options?: { upsert?: boolean; contentType?: string }
    ): Promise<{ data: unknown; error: { message: string } | null }>;
    download(
      path: string
    ): Promise<{ data: Blob | null; error: { message: string } | null }>;
  };
};

export type StorageDeps = { storage?: ReportStorage };

/** Resolve the injected storage client, or default to the service client's storage. */
function resolveStorage(deps: StorageDeps): ReportStorage {
  return deps.storage ?? (createServiceClient().storage as unknown as ReportStorage);
}

/** Object key for a shop+period PDF. */
export function pdfKey(shopId: string, period: string): string {
  return `${shopId}/${period}.pdf`;
}

/** Object key for a shop+period narrative JSON. */
export function narrativeKey(shopId: string, period: string): string {
  return `${shopId}/${period}.json`;
}

/**
 * Upload the rendered PDF for a shop+period (idempotent upsert). Throws on a
 * storage error (no bare catch — resilience constraint).
 */
export async function storeReportPdf(
  shopId: string,
  period: string,
  bytes: Uint8Array,
  deps: StorageDeps = {}
): Promise<{ path: string }> {
  const storage = resolveStorage(deps);
  const path = pdfKey(shopId, period);
  const { error } = await storage.from(REPORTS_BUCKET).upload(path, bytes, {
    upsert: true,
    contentType: "application/pdf",
  });
  if (error) {
    throw new Error(`storeReportPdf failed: ${error.message}`);
  }
  return { path };
}

/**
 * Persist the eval-passed narrative JSON so the print route renders the EXACT bytes
 * that passed the 12-02 gate (never a re-generated narrative). Idempotent upsert.
 */
export async function storeReportNarrative(
  shopId: string,
  period: string,
  narrative: ReportNarrative,
  deps: StorageDeps = {}
): Promise<{ path: string }> {
  const storage = resolveStorage(deps);
  const path = narrativeKey(shopId, period);
  const { error } = await storage
    .from(REPORTS_BUCKET)
    .upload(path, JSON.stringify(narrative), {
      upsert: true,
      contentType: "application/json",
    });
  if (error) {
    throw new Error(`storeReportNarrative failed: ${error.message}`);
  }
  return { path };
}

/**
 * Load the persisted narrative JSON for a shop+period. Returns null when the object
 * is absent (the print route then has no narrative to render). Throws only on a real
 * storage error (a missing object resolves to null, never an exception).
 */
export async function loadReportNarrative(
  shopId: string,
  period: string,
  deps: StorageDeps = {}
): Promise<ReportNarrative | null> {
  const storage = resolveStorage(deps);
  const path = narrativeKey(shopId, period);
  const { data, error } = await storage.from(REPORTS_BUCKET).download(path);
  if (error) {
    // A not-found is the expected "no narrative yet" path -> null, not a throw.
    if (/not.?found|does not exist|404/i.test(error.message)) return null;
    throw new Error(`loadReportNarrative failed: ${error.message}`);
  }
  if (!data) return null;
  const text = await data.text();
  return JSON.parse(text) as ReportNarrative;
}
