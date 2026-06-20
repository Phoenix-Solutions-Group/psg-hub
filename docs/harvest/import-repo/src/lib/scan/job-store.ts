import type { ScanJob, ScanDriver } from "./types";

const store = new Map<string, ScanJob>();

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const MAX_JOBS = 1000;

export function createJob(id: string, fileName: string): ScanJob {
  if (store.size >= MAX_JOBS) {
    purgeOldJobs();
    if (store.size >= MAX_JOBS) {
      const oldest = [...store.entries()].sort(
        (a, b) => a[1].startedAt - b[1].startedAt
      )[0];
      if (oldest) store.delete(oldest[0]);
    }
  }

  const job: ScanJob = {
    id,
    fileName,
    pageCount: 0,
    status: "uploading",
    pages: [],
    mergedRow: null,
    error: null,
    startedAt: Date.now(),
    driverUsed: null,
  };
  store.set(id, job);
  return job;
}

export function updateJob(
  id: string,
  partial: Partial<Pick<ScanJob, "status" | "pageCount" | "driverUsed" | "error" | "pages" | "mergedRow">>
): void {
  const job = store.get(id);
  if (!job) return;
  Object.assign(job, partial);
}

export function getJob(id: string): ScanJob | null {
  return store.get(id) ?? null;
}

export function purgeOldJobs(maxAgeMs: number = MAX_AGE_MS): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, job] of store) {
    if (job.startedAt < cutoff) {
      store.delete(id);
      removed++;
    }
  }
  return removed;
}
