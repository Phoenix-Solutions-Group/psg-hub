import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSupabaseSeedEnvNotCrossWired,
  loadSeedEnvFiles,
} from "../../../../scripts/supabase-seed-env-guard.mjs";

const tempDirs: string[] = [];

function writeTempEnv(name: string, text: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psg-seed-env-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, text);
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Supabase seed env guard", () => {
  it("allows the Supabase URL and service key from the same env file", () => {
    const env: Record<string, string | undefined> = {};
    const file = writeTempEnv(
      ".env.local",
      [
        "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY=service-role-key",
      ].join("\n")
    );

    const sources = loadSeedEnvFiles([file], env);

    expect(() => assertSupabaseSeedEnvNotCrossWired(sources, env)).not.toThrow();
  });

  it("rejects a Supabase URL and service key loaded from different env files", () => {
    const env: Record<string, string | undefined> = {};
    const urlFile = writeTempEnv(
      ".env.preview.local",
      "NEXT_PUBLIC_SUPABASE_URL=https://preview.supabase.co"
    );
    const keyFile = writeTempEnv(".env.local", "SUPABASE_SERVICE_ROLE_KEY=local-key");

    const sources = loadSeedEnvFiles([urlFile, keyFile], env);

    expect(() => assertSupabaseSeedEnvNotCrossWired(sources, env)).toThrow(
      "Refusing to run Supabase seed with mixed environment sources"
    );
  });

  it("supports an explicit mixed-env override for manually verified seed runs", () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_SEED_ALLOW_MIXED_ENV: "1",
    };
    const urlFile = writeTempEnv(
      ".env.preview.local",
      "NEXT_PUBLIC_SUPABASE_URL=https://preview.supabase.co"
    );
    const keyFile = writeTempEnv(".env.local", "SUPABASE_SERVICE_ROLE_KEY=local-key");

    const sources = loadSeedEnvFiles([urlFile, keyFile], env);

    expect(() => assertSupabaseSeedEnvNotCrossWired(sources, env)).not.toThrow();
  });
});
