import { describe, expect, it, vi } from "vitest";
import {
  ADS_MUTATION_LOGS_BUCKET,
  StorageLogMirror,
  logKey,
  type LogStorage,
} from "@/lib/ads-mutations/log-storage";

function fakeStorage(
  upload: (path: string, body: unknown) => { error: { message: string } | null }
): { storage: LogStorage; uploads: Array<{ bucket: string; path: string; body: unknown }> } {
  const uploads: Array<{ bucket: string; path: string; body: unknown }> = [];
  return {
    uploads,
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, body: unknown) {
            uploads.push({ bucket, path, body });
            return { data: {}, ...upload(path, body) };
          },
        };
      },
    },
  };
}

describe("logKey", () => {
  it("namespaces by target + sandbox + mode and sanitizes the target", () => {
    expect(logKey("123", "sbx-1", "execute")).toMatch(/^123\/sbx-1-execute-.*\.json$/);
    // A malformed ref cannot escape its folder: every non [A-Za-z0-9_-] char (incl. "/")
    // is replaced, so there is exactly one folder segment and no path traversal.
    const k = logKey("../../etc", "sbx", "dry_run");
    expect(k).toBe("______etc/sbx-dry_run-" + k.split("-dry_run-")[1]);
    expect(k).not.toContain("..");
    expect(k.split("/")).toHaveLength(2);
  });
});

describe("StorageLogMirror", () => {
  it("uploads JSON to the private bucket and returns the path", async () => {
    const { storage, uploads } = fakeStorage(() => ({ error: null }));
    const mirror = new StorageLogMirror(storage);
    const path = await mirror.store({
      targetRef: "123",
      sandboxId: "sbx-1",
      mode: "execute",
      log: { op: "x", after: [1, 2] },
    });
    expect(path).toBeDefined();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe(ADS_MUTATION_LOGS_BUCKET);
    expect(uploads[0].path).toBe(path);
    expect(JSON.parse(uploads[0].body as string)).toEqual({ op: "x", after: [1, 2] });
  });

  it("returns undefined (not throw) on a storage error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { storage } = fakeStorage(() => ({ error: { message: "bucket missing" } }));
    const mirror = new StorageLogMirror(storage);
    const path = await mirror.store({
      targetRef: "123",
      sandboxId: "sbx-1",
      mode: "dry_run",
      log: { op: "x" },
    });
    expect(path).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns undefined (not throw) when upload throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing: LogStorage = {
      from() {
        return {
          async upload() {
            throw new Error("network down");
          },
        };
      },
    };
    const mirror = new StorageLogMirror(throwing);
    const path = await mirror.store({
      targetRef: "123",
      sandboxId: "sbx-1",
      mode: "dry_run",
      log: { op: "x" },
    });
    expect(path).toBeUndefined();
    warn.mockRestore();
  });
});
