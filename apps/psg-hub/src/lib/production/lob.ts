import "server-only";
import {
  CircuitBreaker,
  CircuitOpenError,
  withRetry,
  type RetryOptions,
} from "@/lib/resilience";
import {
  MailProductionError,
  type AddressDeliverability,
  type AddressVerificationResult,
  type MailAddress,
  type MailAdapter,
  type MailDocument,
  type MailJobStatus,
  type MailSubmissionResult,
} from "./types";

/**
 * Lob.com production-mail adapter — implements `MailAdapter` (src/lib/production/types.ts).
 *
 * Mirrors the SMS / SendGrid adapters: a thin client wrapped in the shared
 * circuit breaker + retry (PROJECT.md: retry + circuit breaker on every external
 * call, no bare catches). It talks Lob's REST API directly via `fetch` rather
 * than pulling the `lob` SDK — the surface we need (us_verifications, postcards,
 * letters, self_mailers) is small, and a dependency-free adapter keeps the
 * bundle lean and the auth model explicit.
 *
 * AUTH: HTTP Basic, API key as the username, empty password. A `test_*` key
 * targets Lob test mode (free, no per-piece spend) — that is what the build
 * verifies against; the live `live_*` key (and the per-piece + API spend it
 * incurs) is gated behind board gate G4 and only set in prod env.
 *
 * KEY DIVERGENCE from the email/SMS adapters: Lob returns a JSON `{ error }`
 * envelope (not an exception with `.status`/`.code`), so `fetch` resolves even
 * on 4xx/5xx — we read `response.status` ourselves and classify from that.
 */

const LOB_API_BASE = "https://api.lob.com/v1";

function getApiKey(): string {
  const key = process.env.LOB_API_KEY;
  if (!key) {
    throw new MailProductionError("Missing LOB_API_KEY", {
      vendor: "lob",
      retryable: false,
    });
  }
  return key;
}

/** Basic-auth header for Lob: base64("<api_key>:"). */
function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

/** Transient = 429 or 5xx, or a network error with no HTTP status. */
export function isRetryableLobStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return true;
  }
  return status === 429 || status >= 500;
}

/**
 * Map a Lob lifecycle string to the canonical `MailJobStatus`. Accepts both the
 * webhook `event_type.id` form ("postcard.delivered") and bare tracking-event
 * names ("processed_for_delivery"), so the same mapper serves submit responses
 * and webhooks.
 */
export function mapLobStatus(lobStatus: string | null | undefined): MailJobStatus {
  if (!lobStatus) return "unknown";
  // Strip a leading resource prefix: "postcard.delivered" -> "delivered".
  const name = lobStatus.includes(".")
    ? lobStatus.slice(lobStatus.indexOf(".") + 1)
    : lobStatus;
  switch (name) {
    case "created":
      return "created";
    case "rendered_pdf":
    case "rendered_thumbnails":
    case "rendered":
      return "rendered";
    case "mailed":
      return "mailed";
    case "in_transit":
      return "in_transit";
    case "in_local_area":
      return "in_local_area";
    case "processed_for_delivery":
      return "processed_for_delivery";
    case "delivered":
      return "delivered";
    case "re-routed":
    case "re_routed":
      return "re_routed";
    case "returned_to_sender":
      return "returned_to_sender";
    case "deleted":
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

/** Map Lob `us_verifications.deliverability` to canonical `AddressDeliverability`. */
export function mapLobDeliverability(value: string | null | undefined): AddressDeliverability {
  switch (value) {
    case "deliverable":
      return "deliverable";
    case "deliverable_unnecessary_unit":
    case "deliverable_incorrect_unit":
      return "deliverable_with_unit_correction";
    case "deliverable_missing_unit":
      return "deliverable_missing_unit";
    case "undeliverable":
      return "undeliverable";
    default:
      return "unknown";
  }
}

/** Lob address payload shape (shared by verification + postcard/letter to/from). */
function toLobAddress(address: MailAddress): Record<string, string> {
  const payload: Record<string, string> = {
    name: address.name,
    address_line1: address.addressLine1,
    address_city: address.city,
    address_state: address.state,
    address_zip: address.zip,
    address_country: address.country ?? "US",
  };
  if (address.addressLine2) payload.address_line2 = address.addressLine2;
  return payload;
}

interface LobErrorBody {
  error?: { message?: string; status_code?: number; code?: string };
}

export interface LobAdapterOptions {
  /** Override the circuit breaker (tests inject a fast-tripping one). */
  breaker?: CircuitBreaker;
  /** Override retry behaviour (tests inject no-op sleep / zero retries). */
  retry?: RetryOptions;
  /** Override the fetch implementation (tests inject a stub). */
  fetchImpl?: typeof fetch;
  /** Override the API key (defaults to LOB_API_KEY). */
  apiKey?: string;
}

export class LobAdapter implements MailAdapter {
  readonly vendor = "lob" as const;

  private readonly breaker: CircuitBreaker;
  private readonly retry: RetryOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKeyOverride?: string;

  constructor(options: LobAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiKeyOverride = options.apiKey;
    this.breaker =
      options.breaker ??
      new CircuitBreaker({
        failureThreshold: 5,
        resetTimeoutMs: 30_000,
        // Only transient failures trip the breaker — a 4xx is a caller bug,
        // not a Lob outage.
        isFailure: (error) =>
          error instanceof MailProductionError ? error.retryable : true,
      });
    this.retry = {
      retries: 3,
      baseDelayMs: 200,
      maxDelayMs: 5000,
      isRetryable: (error) =>
        error instanceof MailProductionError ? error.retryable : true,
      ...options.retry,
    };
  }

  private apiKey(): string {
    return this.apiKeyOverride ?? getApiKey();
  }

  /**
   * POST form-encoded params to a Lob endpoint, under breaker + retry. Lob
   * accepts application/x-www-form-urlencoded and resolves 4xx/5xx with a JSON
   * `{ error }` body, so we classify from `response.status`.
   */
  private async post<T>(path: string, params: URLSearchParams, idempotencyKey?: string): Promise<T> {
    const apiKey = this.apiKey();
    const headers: Record<string, string> = {
      Authorization: authHeader(apiKey),
      "Content-Type": "application/x-www-form-urlencoded",
    };
    // Lob honours Idempotency-Key on create endpoints: a retried submit with the
    // same key returns the original resource instead of mailing a second piece.
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const run = async (): Promise<T> => {
      let response: Response;
      try {
        response = await this.fetchImpl(`${LOB_API_BASE}${path}`, {
          method: "POST",
          headers,
          body: params.toString(),
        });
      } catch (cause) {
        // Network / DNS error — no HTTP status, treat as transient.
        throw new MailProductionError("Lob request failed (network)", {
          vendor: "lob",
          retryable: true,
          cause,
        });
      }
      if (!response.ok) {
        let message = `Lob ${path} failed (status ${response.status})`;
        try {
          const body = (await response.json()) as LobErrorBody;
          if (body.error?.message) message = body.error.message;
        } catch {
          // Non-JSON error body — keep the generic message.
        }
        throw new MailProductionError(message, {
          vendor: "lob",
          statusCode: response.status,
          retryable: isRetryableLobStatus(response.status),
        });
      }
      return (await response.json()) as T;
    };

    try {
      return await this.breaker.execute(() => withRetry(run, this.retry));
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        throw new MailProductionError("Lob circuit open — production paused", {
          vendor: "lob",
          retryable: true,
          cause: error,
        });
      }
      throw error;
    }
  }

  async verifyAddress(address: MailAddress): Promise<AddressVerificationResult> {
    const params = new URLSearchParams({
      primary_line: address.addressLine1,
      city: address.city,
      state: address.state,
      zip_code: address.zip,
    });
    if (address.addressLine2) params.set("secondary_line", address.addressLine2);

    const result = await this.post<{
      deliverability?: string;
      primary_line?: string;
      secondary_line?: string;
      components?: { city?: string; state?: string; zip_code?: string };
    }>("/us_verifications", params);

    const deliverability = mapLobDeliverability(result.deliverability);
    const normalized: MailAddress | undefined = result.primary_line
      ? {
          name: address.name,
          addressLine1: result.primary_line,
          addressLine2: result.secondary_line || undefined,
          city: result.components?.city ?? address.city,
          state: result.components?.state ?? address.state,
          zip: result.components?.zip_code ?? address.zip,
          country: "US",
        }
      : undefined;

    return {
      deliverability,
      deliverable: deliverability === "deliverable",
      normalized,
      raw: result,
    };
  }

  async submit(document: MailDocument): Promise<MailSubmissionResult> {
    const params = new URLSearchParams();
    // to / from as nested form fields (Lob accepts `to[address_line1]=...`).
    for (const [key, value] of Object.entries(toLobAddress(document.to))) {
      params.set(`to[${key}]`, value);
    }
    for (const [key, value] of Object.entries(toLobAddress(document.from))) {
      params.set(`from[${key}]`, value);
    }
    if (document.description) params.set("description", document.description);
    for (const [key, value] of Object.entries(document.metadata ?? {})) {
      params.set(`metadata[${key}]`, value);
    }

    let path: string;
    if (document.pieceType === "postcard") {
      path = "/postcards";
      // Postcards support explicit sizing.
      params.set("size", document.size ?? "4x6");
      if (document.front) params.set("front", document.front);
      if (document.back) params.set("back", document.back);
    } else if (document.pieceType === "self_mailer") {
      path = "/self_mailers";
      params.set("size", document.size ?? "6x18_bifold");
      if (document.inside) params.set("inside", document.inside);
      if (document.outside) params.set("outside", document.outside);
      // Required by Lob; PSG's direct-mail program is retention/marketing.
      params.set("use_type", "marketing");
    } else {
      path = "/letters";
      if (document.file) params.set("file", document.file);
      if (document.color !== undefined) params.set("color", String(document.color));
      // Lob requires an address-placement choice; PSG uses the top first-page
      // envelope placement for all letter-family mailers.
      params.set("address_placement", "top_first_page");
      // Required by Lob; PSG's direct-mail program is retention/marketing.
      params.set("use_type", "marketing");
    }

    const result = await this.post<{
      id: string;
      expected_delivery_date?: string;
      url?: string;
      thumbnails?: Array<{ small?: string; medium?: string; large?: string }>;
      status?: string;
    }>(path, params, document.documentId);

    return {
      vendor: "lob",
      externalId: result.id,
      // Create responses don't carry a tracking status; the piece is "created"
      // until the first webhook moves it forward.
      status: mapLobStatus(result.status) === "unknown" ? "created" : mapLobStatus(result.status),
      expectedDeliveryDate: result.expected_delivery_date ?? null,
      proofUrl: result.url ?? result.thumbnails?.[0]?.large ?? null,
    };
  }

  async cancel(externalId: string): Promise<void> {
    const apiKey = this.apiKey();
    // Lob cancels via DELETE on the resource collection; id prefixes identify
    // postcards, letters, and self-mailers.
    const collection = externalId.startsWith("ltr_")
      ? "letters"
      : externalId.startsWith("sfm_")
        ? "self_mailers"
        : "postcards";
    const run = async (): Promise<void> => {
      let response: Response;
      try {
        response = await this.fetchImpl(`${LOB_API_BASE}/${collection}/${externalId}`, {
          method: "DELETE",
          headers: { Authorization: authHeader(apiKey) },
        });
      } catch (cause) {
        throw new MailProductionError("Lob cancel failed (network)", {
          vendor: "lob",
          retryable: true,
          cause,
        });
      }
      // 200 = cancelled; 404/422 = already mailed / not found — non-retryable.
      if (!response.ok) {
        throw new MailProductionError(`Lob cancel failed (status ${response.status})`, {
          vendor: "lob",
          statusCode: response.status,
          retryable: isRetryableLobStatus(response.status),
        });
      }
    };

    try {
      await this.breaker.execute(() => withRetry(run, this.retry));
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        throw new MailProductionError("Lob circuit open — production paused", {
          vendor: "lob",
          retryable: true,
          cause: error,
        });
      }
      throw error;
    }
  }
}

/** Default Lob adapter instance (production env wiring). Tests build their own. */
export function createLobAdapter(options: LobAdapterOptions = {}): LobAdapter {
  return new LobAdapter(options);
}
