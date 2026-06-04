import "server-only";
import twilio from "twilio";
import {
  CircuitBreaker,
  CircuitOpenError,
  withRetry,
  type RetryOptions,
} from "@/lib/resilience";
import { SmsError, type SmsMessage, type SmsResult } from "./types";

/**
 * Twilio SMS adapter — mirrors the SendGrid mail adapter (src/lib/mail/sendgrid.ts):
 * a lazy-singleton client (like getStripe) wrapped in the shared circuit breaker +
 * retry (PROJECT.md: retry + circuit breaker on every external call, no bare catches).
 *
 * KEY DIVERGENCE from the mail adapter: Twilio's RestException carries the HTTP status
 * in `error.status` (and the Twilio *vendor* error code in `error.code`) — the inverse
 * of SendGrid's ResponseError, which puts the HTTP status in `.code`. So `statusOf`
 * reads `.status`. Reusing the mail adapter's `statusOf` verbatim would read the wrong
 * field and misclassify every Twilio error.
 */

let twilioInstance: ReturnType<typeof twilio> | null = null;

function getTwilioClient(): ReturnType<typeof twilio> {
  if (!twilioInstance) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error("Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
    }
    // `twilio(...)` is a factory, not a class — never `new twilio()`.
    twilioInstance = twilio(accountSid, authToken);
  }
  return twilioInstance;
}

/** Extract the HTTP status from a Twilio RestException (`.status`), if present. */
function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
}

/** Transient = 429 or 5xx, or an unknown/network error with no numeric HTTP status. */
export function isRetryableTwilioError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === undefined) {
    return true;
  }
  return status === 429 || status >= 500;
}

interface TwilioCreatePayload {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
  statusCallback?: string;
}

export interface SmsSenderOptions {
  /** Override the circuit breaker (tests inject a fast-tripping one). */
  breaker?: CircuitBreaker;
  /** Override retry behaviour (tests inject no-op sleep / zero retries). */
  retry?: RetryOptions;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<SmsResult>;
}

/**
 * Build an SMS sender with a given breaker + retry policy. The default instance
 * (`sendSms`) uses production defaults; tests build their own with fast seams.
 */
export function createSmsSender(options: SmsSenderOptions = {}): SmsSender {
  const breaker =
    options.breaker ??
    new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      // Only transient failures should trip the breaker — a permanent 4xx is a
      // caller bug, not a provider outage.
      isFailure: isRetryableTwilioError,
    });

  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableTwilioError,
    ...options.retry,
  };

  async function send(message: SmsMessage): Promise<SmsResult> {
    const messagingServiceSid =
      message.messagingServiceSid ?? process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from = message.from ?? process.env.TWILIO_PHONE_NUMBER;
    if (!messagingServiceSid && !from) {
      throw new SmsError(
        "Missing sender (set TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER)",
        { retryable: false }
      );
    }

    // Exactly one primary sender: prefer the Messaging Service (sender pool,
    // failover, opt-out/compliance) over a bare from-number.
    const payload: TwilioCreatePayload = {
      to: message.to,
      body: message.body,
      ...(messagingServiceSid ? { messagingServiceSid } : { from }),
      ...(message.statusCallback ? { statusCallback: message.statusCallback } : {}),
    };

    const client = getTwilioClient();

    try {
      const result = await breaker.execute(() =>
        withRetry(() => client.messages.create(payload), retry)
      );
      return {
        sid: result.sid,
        status: result.status,
        errorCode: result.errorCode,
      };
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        throw new SmsError("SMS service circuit open — sending paused", {
          retryable: true,
          cause: error,
        });
      }
      if (error instanceof SmsError) {
        throw error;
      }
      const status = statusOf(error);
      throw new SmsError(
        `Twilio send failed${status !== undefined ? ` (status ${status})` : ""}`,
        { statusCode: status, retryable: isRetryableTwilioError(error), cause: error }
      );
    }
  }

  return { send };
}

const defaultSender = createSmsSender();

/** Send a transactional SMS via Twilio (resilient: retry + circuit breaker). */
export function sendSms(message: SmsMessage): Promise<SmsResult> {
  return defaultSender.send(message);
}
