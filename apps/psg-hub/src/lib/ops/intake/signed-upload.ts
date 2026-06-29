// Track A / PSG-394 — Pilot-intake signed-upload helper.
//
// Mints a time-limited Supabase signed-upload URL for a caller-named object under
// the private "pilot-intake" bucket, so a superadmin can hand Nick a one-time,
// expiring link to drop the real RO/Estimate export (feeds PSG-387 E2E). No file
// contents ever pass through the app — only the object path.
//
// The path/object name is built + validated here (pure, unit-testable) so the
// route stays a thin auth+wiring shell. The storage client is dependency-injected
// (deps.storage); the default binding is the service client's storage — uploads to
// pilot-intake are service-role/signed-token only (the bucket has no session-write
// RLS policy), matching report/storage.ts.

import { createServiceClient } from "@/lib/supabase/service";

/** The private bucket holding the raw pilot FileMaker RO/Estimate export. */
export const PILOT_INTAKE_BUCKET = "pilot-intake";

// Path convention: "{companySlug}/{shopSlug}/{fileName}". Slugs are lowercase
// kebab (matches public.shops.slug); the file name is a single safe segment.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const MAX_SEGMENT = 100;

export type SignedUploadInput = {
  companySlug: string;
  shopSlug: string;
  fileName: string;
};

/** The minimal storage surface this module needs (signed-upload URL mint). */
export type IntakeStorage = {
  from(bucket: string): {
    createSignedUploadUrl(path: string): Promise<{
      data: { signedUrl: string; token: string; path: string } | null;
      error: { message: string } | null;
    }>;
  };
};

export type IntakeStorageDeps = { storage?: IntakeStorage };

/** Resolve the injected storage client, or default to the service client's storage. */
function resolveStorage(deps: IntakeStorageDeps): IntakeStorage {
  return deps.storage ?? (createServiceClient().storage as unknown as IntakeStorage);
}

export class IntakePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakePathError";
  }
}

function requireSlug(label: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IntakePathError(`${label} is required`);
  }
  if (value.length > MAX_SEGMENT || !SLUG_RE.test(value)) {
    throw new IntakePathError(`${label} must be a lowercase kebab-case slug`);
  }
  return value;
}

/**
 * Build + validate the storage object path from caller input. Rejects anything
 * that is not a clean "{companySlug}/{shopSlug}/{fileName}" triple — no path
 * traversal ("..", "/", "\"), no leading dot, no control chars — so the minted
 * token can never escape the bucket prefix. Pure; throws IntakePathError on bad input.
 */
export function buildIntakePath(input: SignedUploadInput): string {
  const companySlug = requireSlug("companySlug", input.companySlug);
  const shopSlug = requireSlug("shopSlug", input.shopSlug);

  const fileName = input.fileName;
  if (typeof fileName !== "string" || fileName.length === 0) {
    throw new IntakePathError("fileName is required");
  }
  if (fileName.length > MAX_SEGMENT) {
    throw new IntakePathError("fileName is too long");
  }
  if (fileName.includes("..") || !FILE_NAME_RE.test(fileName)) {
    throw new IntakePathError(
      "fileName must be a single safe segment (letters, digits, dot, dash, underscore)",
    );
  }

  return `${companySlug}/${shopSlug}/${fileName}`;
}

export type MintedUpload = {
  path: string;
  signedUrl: string;
  token: string;
};

/**
 * Mint a time-limited signed-upload URL for the given intake object. Validates the
 * path first, then calls createSignedUploadUrl through the (injected) storage
 * client. Throws on a bad path (IntakePathError) or a storage error — no bare catch.
 *
 * Supabase signed-upload URLs are single-use and expire (2h default); the returned
 * token authorizes exactly one upload to `path` and bypasses the bucket's
 * default-deny session RLS, so no INSERT policy is needed.
 */
export async function mintIntakeSignedUpload(
  input: SignedUploadInput,
  deps: IntakeStorageDeps = {},
): Promise<MintedUpload> {
  const path = buildIntakePath(input);
  const storage = resolveStorage(deps);
  const { data, error } = await storage.from(PILOT_INTAKE_BUCKET).createSignedUploadUrl(path);
  if (error) {
    throw new Error(`mintIntakeSignedUpload failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("mintIntakeSignedUpload failed: no signed URL returned");
  }
  return { path: data.path ?? path, signedUrl: data.signedUrl, token: data.token };
}
