import { isLobTestKey } from "./seed-test";
import type { MailVendor } from "./types";

export function productionBrowserTestVendor(lobApiKey: string | undefined | null): MailVendor {
  const trimmedKey = lobApiKey?.trim();
  if (!trimmedKey) return "inhouse";
  if (isLobTestKey(trimmedKey)) return "lob";

  throw new Error(
    "Production browser gate refused unsafe Lob setup: LOB_API_KEY is present but is not a test_* key. " +
      "Use a Lob test-mode key for QA, or unset LOB_API_KEY to use the in-house print fallback."
  );
}
