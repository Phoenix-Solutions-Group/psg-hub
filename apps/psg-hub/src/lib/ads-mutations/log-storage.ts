import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { LogMirror } from "./bridge";
import type { MutationMode } from "./types";

/**
 * v1.2 Ads Mutation Studio — mirror the Python runner's structured log JSON to durable,
 * private Supabase Storage. The path is recorded on python_worker_jobs.logs_storage_path
 * (and ads_audit_logs for executes) so an operator can inspect exactly what the worker did.
 *
 * Writes go through the service client (RLS-bypass). The bucket is private and
 * service-role-write only — there is no customer read path (these are internal ops logs),
 * unlike the monthly-reports bucket. The bucket is provisioned at the live-activation
 * operator gate (PSG-26c / PSG-98); see ADS_MUTATION_LOGS_BUCKET.
 *
 * Best-effort by design: a storage failure must NOT fail an otherwise-successful mutation
 * (the diff + audit row are the source of truth). On error we warn and return undefined so
 * the job records a null logs path rather than rolling back a real Google Ads change.
 */
export const ADS_MUTATION_LOGS_BUCKET = "ads-mutation-logs";

/** Minimal storage surface this module needs (mirrors report/storage.ts). */
export type LogStorage = {
  from(bucket: string): {
    upload(
      path: string,
      body: ArrayBuffer | ArrayBufferView | Blob | Uint8Array | string,
      options?: { upsert?: boolean; contentType?: string }
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

/** Object key for one runner log: "{targetRef}/{sandboxId}-{mode}-{ts}.json". */
export function logKey(targetRef: string, sandboxId: string, mode: MutationMode): string {
  // Keep keys filesystem-safe: targetRef is a numeric customer id / GTM public id, but
  // sanitize defensively so a malformed ref can never escape the bucket folder.
  const safeTarget = (targetRef || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safeTarget}/${sandboxId}-${mode}-${ts}.json`;
}

export class StorageLogMirror implements LogMirror {
  private storage?: LogStorage;

  constructor(storage?: LogStorage) {
    this.storage = storage;
  }

  private resolveStorage(): LogStorage {
    return (
      this.storage ?? (createServiceClient().storage as unknown as LogStorage)
    );
  }

  async store(input: {
    targetRef: string;
    sandboxId: string;
    mode: MutationMode;
    log: unknown;
  }): Promise<string | undefined> {
    const path = logKey(input.targetRef, input.sandboxId, input.mode);
    const body = JSON.stringify(input.log, null, 2);
    try {
      const { error } = await this.resolveStorage()
        .from(ADS_MUTATION_LOGS_BUCKET)
        .upload(path, body, { upsert: true, contentType: "application/json" });
      if (error) {
        console.warn(`[ads-mutations] log mirror failed (${path}): ${error.message}`);
        return undefined;
      }
      return path;
    } catch (err) {
      console.warn(
        `[ads-mutations] log mirror threw (${path}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return undefined;
    }
  }
}
